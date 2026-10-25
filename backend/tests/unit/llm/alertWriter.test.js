import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { acceptItem, createAlertWriter, parseLlmResponse } from '../../../src/services/llm/alertWriter.js';
import { LlmTimeoutError, createGeminiClient } from '../../../src/services/llm/geminiClient.js';
import { renderTemplate } from '../../../src/services/llm/templates.js';
import { THRESHOLDS, findingOf, specFinding } from '../../fixtures.js';
import { captureLogger } from '../../helpers.js';

const LLM = { enabled: true, maxRetries: 2, maxItems: 50 };
const FALLBACK = 'Alert text fell back to template';
const HIGH_DEMAND = () =>
  new ApiError({
    status: 503,
    message: '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
  });

const req = (finding, escalation = null) => ({ finding, escalation });
const billing = () => findingOf({ api_name: 'BillingAPI', status_code: 401, records_returned: 3 });

const goodSpecItem = (id = 'a1') => ({
  id,
  title: 'AppointmentAPI failing and slow',
  message: 'AppointmentAPI returned HTTP 500 with 0 records after 5500 ms; likely an outage.',
  suggested_action: 'Check the service logs.',
});
const goodBillingItem = (id = 'a2') => ({
  id,
  title: 'BillingAPI auth failures',
  message: 'BillingAPI rejected requests with 401 and returned 3 records; credentials likely expired.',
  suggested_action: 'Rotate the API token.',
});

/** Fake client: each call shifts the next scripted result (a value or an Error to throw). */
function scriptedClient(...script) {
  const calls = [];
  return {
    model: 'fake-model',
    calls,
    async generateJson(args) {
      calls.push(args);
      const next = script.length > 1 ? script.shift() : script[0];
      if (next instanceof Error) throw next;
      return typeof next === 'string' ? next : JSON.stringify(next);
    },
  };
}

/** Same scripted client under another model name (for fallback models). */
const modelClient = (model, ...script) => Object.assign(scriptedClient(...script), { model });

function writerWith(client, llm = {}, fallbackClients = []) {
  const sleeps = [];
  const writer = createAlertWriter({
    llm: { ...LLM, ...llm },
    thresholds: THRESHOLDS,
    client,
    fallbackClients,
    sleep: async (ms) => sleeps.push(ms),
    random: () => 1,
  });
  return { writer, sleeps };
}

async function write(client, requests, llm, fallbackClients) {
  const { writer, sleeps } = writerWith(client, llm, fallbackClients);
  const capture = captureLogger();
  const result = await writer.writeMessages(requests, { log: capture.log });
  return { ...result, sleeps, ...capture };
}

describe('alertWriter', () => {
  it('skips the call when nothing needs text', async () => {
    const client = scriptedClient({ alerts: [] });
    const { messages, llm } = await write(client, []);
    expect(client.calls).toHaveLength(0);
    expect(messages.size).toBe(0);
    expect(llm).toEqual({ status: 'skipped', model: null, attempts: 0, latency_ms: null, fallbacks: [] });
  });

  it('uses the LLM text for every item in one call', async () => {
    const client = scriptedClient({ alerts: [goodSpecItem(), goodBillingItem()] });
    const { messages, llm, entries } = await write(client, [req(specFinding()), req(billing())]);

    expect(client.calls).toHaveLength(1);
    expect(JSON.parse(client.calls[0].userContent).items.map((i) => i.api_name)).toEqual([
      'AppointmentAPI',
      'BillingAPI',
    ]);
    expect(messages.get('appointmentapi')).toEqual({
      title: goodSpecItem().title,
      message: goodSpecItem().message,
      suggested_action: goodSpecItem().suggested_action,
      message_source: 'llm',
      message_model: 'fake-model',
    });
    expect(messages.get('billingapi').message_source).toBe('llm');
    expect(llm).toMatchObject({ status: 'ok', attempts: 1, fallbacks: [] });
    expect(entries.filter((e) => e.level >= 40)).toEqual([]);
  });

  it('accepts "5,500" from the LLM thanks to number normalization', async () => {
    const item = { ...goodSpecItem(), message: 'AppointmentAPI returned 500 and 0 records in 5,500 ms.' };
    const { messages } = await write(scriptedClient({ alerts: [item] }), [req(specFinding())]);
    expect(messages.get('appointmentapi').message_source).toBe('llm');
  });

  it('falls back per item when the fact-check fails, and warns with the reason', async () => {
    const converted = {
      ...goodSpecItem(),
      message: 'AppointmentAPI returned 500 and 0 records in 5.5 seconds.',
    };
    const { messages, llm, warnings } = await write(
      scriptedClient({ alerts: [converted, goodBillingItem()] }),
      [req(specFinding()), req(billing())],
    );

    expect(messages.get('appointmentapi')).toEqual(renderTemplate(specFinding(), THRESHOLDS));
    expect(messages.get('billingapi').message_source).toBe('llm');
    expect(llm.status).toBe('partial');
    expect(llm.fallbacks).toEqual([{ api_name: 'AppointmentAPI', reason: 'fact_check_failed' }]);
    expect(warnings(FALLBACK)).toEqual([
      {
        api_name: 'AppointmentAPI',
        fingerprint: 'appointmentapi',
        reason: 'fact_check_failed',
        detail: 'missing response_time_ms=5500',
      },
    ]);
  });

  it('falls back for an item the LLM left out', async () => {
    const { messages, warnings } = await write(scriptedClient({ alerts: [goodSpecItem()] }), [
      req(specFinding()),
      req(billing()),
    ]);
    expect(messages.get('billingapi').message_source).toBe('template');
    expect(warnings(FALLBACK)).toEqual([
      expect.objectContaining({ api_name: 'BillingAPI', reason: 'missing_item' }),
    ]);
  });

  it('falls back for an invalid item', async () => {
    const { warnings } = await write(scriptedClient({ alerts: [{ ...goodSpecItem(), message: '' }] }), [
      req(specFinding()),
    ]);
    expect(warnings(FALLBACK)).toEqual([expect.objectContaining({ reason: 'invalid_item' })]);
  });

  it.each([
    ['invalid JSON', 'not json', 'invalid_json'],
    ['wrong shape', { items: [] }, 'invalid_response_shape'],
  ])('falls back for every item on %s', async (_label, response, reason) => {
    const { messages, llm, warnings } = await write(scriptedClient(response), [
      req(specFinding()),
      req(billing()),
    ]);
    expect([...messages.values()].map((m) => m.message_source)).toEqual(['template', 'template']);
    expect(llm.status).toBe('fallback');
    expect(warnings(FALLBACK).map((w) => [w.api_name, w.reason])).toEqual([
      ['AppointmentAPI', reason],
      ['BillingAPI', reason],
    ]);
  });

  it('retries a 503 high-demand response and then uses the LLM text', async () => {
    const client = scriptedClient(HIGH_DEMAND(), { alerts: [goodSpecItem()] });
    const { messages, llm, sleeps, warnings } = await write(client, [req(specFinding())]);

    expect(client.calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
    expect(messages.get('appointmentapi').message_source).toBe('llm');
    expect(llm).toMatchObject({ status: 'ok', attempts: 2 });
    expect(warnings('LLM call failed, retrying')).toEqual([
      expect.objectContaining({ attempt: 1, reason: 'unavailable', status: 503 }),
    ]);
    expect(warnings(FALLBACK)).toEqual([]);
  });

  it('falls back after exhausting retries on persistent 503s', async () => {
    const client = scriptedClient(HIGH_DEMAND());
    const { messages, llm, warnings } = await write(client, [req(specFinding())]);

    expect(client.calls).toHaveLength(3);
    expect(messages.get('appointmentapi').message_source).toBe('template');
    expect(llm).toMatchObject({ status: 'fallback', attempts: 3 });
    expect(warnings(FALLBACK)).toEqual([
      expect.objectContaining({
        reason: 'unavailable',
        detail: expect.stringMatching(
          /^status 503 after 3 attempt\(s\) \(models: fake-model\): .*UNAVAILABLE/,
        ),
      }),
    ]);
  });

  it('retries timeouts', async () => {
    const client = scriptedClient(new LlmTimeoutError(8000), { alerts: [goodSpecItem()] });
    const { llm } = await write(client, [req(specFinding())]);
    expect(llm).toMatchObject({ status: 'ok', attempts: 2 });
  });

  describe('fallback models', () => {
    const OK = { alerts: [goodSpecItem()] };
    const TRYING = 'Trying fallback model';

    it('tries a fallback model once after the primary stays 503, and records which model wrote the text', async () => {
      const primary = scriptedClient(HIGH_DEMAND());
      const fallback = modelClient('gemini-3.5-flash', OK);
      const { messages, llm, warnings, entries } = await write(primary, [req(specFinding())], {}, [fallback]);

      expect(primary.calls).toHaveLength(3); // 1 + LLM_MAX_RETRIES
      expect(fallback.calls).toHaveLength(1);
      expect(messages.get('appointmentapi')).toMatchObject({
        message_source: 'llm',
        message_model: 'gemini-3.5-flash',
      });
      expect(llm).toMatchObject({ status: 'ok', model: 'gemini-3.5-flash', attempts: 4 });
      expect(warnings(TRYING)).toEqual([
        { from_model: 'fake-model', model: 'gemini-3.5-flash', reason: 'unavailable' },
      ]);
      expect(entries.find((e) => e.msg === 'LLM alert text generated')).toMatchObject({
        level: 30,
        model: 'gemini-3.5-flash',
        fallback_model_used: true,
      });
      expect(warnings(FALLBACK)).toEqual([]);
    });

    it('moves on to the next fallback when one fails, trying each only once', async () => {
      const a = modelClient('fallback-a', HIGH_DEMAND());
      const b = modelClient('fallback-b', new LlmTimeoutError(8000));
      const c = modelClient('fallback-c', OK);
      const { messages, llm, warnings } = await write(
        scriptedClient(HIGH_DEMAND()),
        [req(specFinding())],
        {},
        [a, b, c],
      );

      expect([a, b, c].map((x) => x.calls.length)).toEqual([1, 1, 1]);
      expect(messages.get('appointmentapi').message_model).toBe('fallback-c');
      expect(llm).toMatchObject({ status: 'ok', model: 'fallback-c', attempts: 6 });
      expect(warnings(TRYING).map((w) => [w.from_model, w.model, w.reason])).toEqual([
        ['fake-model', 'fallback-a', 'unavailable'],
        ['fallback-a', 'fallback-b', 'unavailable'],
        ['fallback-b', 'fallback-c', 'timeout'],
      ]);
    });

    it('falls back to templates when every model fails, listing the models tried', async () => {
      const a = modelClient('fallback-a', HIGH_DEMAND());
      const { messages, llm, warnings } = await write(
        scriptedClient(HIGH_DEMAND()),
        [req(specFinding())],
        {},
        [a],
      );

      expect(messages.get('appointmentapi')).toMatchObject({
        message_source: 'template',
        message_model: null,
      });
      expect(llm).toMatchObject({ status: 'fallback', model: null, attempts: 4 });
      expect(warnings(FALLBACK)).toEqual([
        expect.objectContaining({
          reason: 'unavailable',
          detail: expect.stringMatching(
            /^status 503 after 4 attempt\(s\) \(models: fake-model, fallback-a\): /,
          ),
        }),
      ]);
    });

    it.each([
      ['a timeout', () => new LlmTimeoutError(8000)],
      ['a 429', () => new ApiError({ status: 429, message: 'quota' })],
      ['a 400', () => new ApiError({ status: 400, message: 'bad request' })],
    ])('does not use fallbacks when the primary fails with %s', async (_label, error) => {
      const fallback = modelClient('fallback-a', OK);
      const { messages } = await write(scriptedClient(error()), [req(specFinding())], {}, [fallback]);
      expect(fallback.calls).toHaveLength(0);
      expect(messages.get('appointmentapi').message_source).toBe('template');
    });

    it('does not use fallbacks when the primary succeeds', async () => {
      const fallback = modelClient('fallback-a', OK);
      const { llm } = await write(scriptedClient(OK), [req(specFinding())], {}, [fallback]);
      expect(fallback.calls).toHaveLength(0);
      expect(llm).toMatchObject({ status: 'ok', model: 'fake-model' });
    });
  });

  it('logs latency at info on success', async () => {
    let t = 0;
    const client = scriptedClient(HIGH_DEMAND(), { alerts: [goodSpecItem()] });
    const writer = createAlertWriter({
      llm: LLM,
      thresholds: THRESHOLDS,
      client,
      sleep: async (ms) => (t += ms),
      random: () => 1,
      now: () => (t += 100), // every clock read advances 100 ms
    });
    const { log, entries } = captureLogger();
    await writer.writeMessages([req(specFinding())], { log });

    const info = entries.filter((e) => e.level === 30 && e.msg === 'LLM alert text generated');
    expect(info).toEqual([
      expect.objectContaining({
        model: 'fake-model',
        items: 1,
        llm_items: 1,
        attempts: 2,
        latency_ms: expect.any(Number),
        attempt_ms: 100,
      }),
    ]);
    expect(info[0].latency_ms).toBeGreaterThan(info[0].attempt_ms); // includes the failed attempt and backoff
  });

  describe('with the real Gemini client (fake transport)', () => {
    const genaiFrom = (...steps) => ({
      models: {
        generateContent: () => {
          const step = steps.shift();
          return typeof step === 'function' ? step() : Promise.reject(step);
        },
      },
    });
    const answer = (ms) => () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ text: JSON.stringify({ alerts: [goodSpecItem()] }) }), ms),
      );

    it('applies the timeout per attempt: 503, then a timeout, then success', async () => {
      const client = createGeminiClient(
        { model: 'm', timeoutMs: 40, thinkingLevel: 'minimal' },
        { genai: genaiFrom(HIGH_DEMAND(), () => new Promise(() => {}), answer(25)) },
      );
      const { messages, llm, warnings } = await write(client, [req(specFinding())]);

      expect(llm).toMatchObject({ status: 'ok', attempts: 3 });
      expect(messages.get('appointmentapi').message_source).toBe('llm');
      expect(warnings('LLM call failed, retrying').map((w) => w.reason)).toEqual(['unavailable', 'timeout']);
    });

    it('a rejected thinking level is retried without thinkingConfig inside the same attempt', async () => {
      const rejected = new ApiError({
        status: 400,
        message: 'Thinking level MINIMAL is not supported for this model.',
      });
      const client = createGeminiClient(
        { model: 'm', timeoutMs: 1000, thinkingLevel: 'minimal' },
        { genai: genaiFrom(rejected, answer(0)) },
      );
      const { llm, warnings } = await write(client, [req(specFinding())]);

      expect(llm).toMatchObject({ status: 'ok', attempts: 1 });
      expect(warnings('Model rejected thinkingConfig; retrying without it')).toHaveLength(1);
      expect(warnings(FALLBACK)).toEqual([]);
    });
  });

  it('does not retry a 400 and falls back immediately', async () => {
    const client = scriptedClient(new ApiError({ status: 400, message: 'bad request' }));
    const { llm, warnings } = await write(client, [req(specFinding())]);
    expect(client.calls).toHaveLength(1);
    expect(llm).toMatchObject({ status: 'fallback', attempts: 1 });
    expect(warnings(FALLBACK)).toEqual([expect.objectContaining({ reason: 'request_rejected' })]);
  });

  it('uses templates with a warning per item when the LLM is disabled', async () => {
    const { writer } = writerWith(null, { enabled: false });
    const { log, warnings } = captureLogger();
    const { messages, llm } = await writer.writeMessages([req(specFinding()), req(billing())], { log });
    expect(messages.size).toBe(2);
    expect(llm.status).toBe('disabled');
    expect(warnings(FALLBACK).map((w) => w.reason)).toEqual(['llm_disabled', 'llm_disabled']);
  });

  it('caps items per call, keeping the most severe; the rest use templates', async () => {
    const medium = findingOf({ api_name: 'SearchAPI', records_returned: 0 });
    const client = scriptedClient({ alerts: [goodSpecItem()] });
    const { messages, llm, warnings } = await write(client, [req(medium), req(specFinding())], {
      maxItems: 1,
    });

    expect(JSON.parse(client.calls[0].userContent).items.map((i) => i.api_name)).toEqual(['AppointmentAPI']);
    expect(messages.get('appointmentapi').message_source).toBe('llm');
    expect(messages.get('searchapi').message_source).toBe('template');
    expect(llm.status).toBe('partial');
    expect(warnings(FALLBACK)).toEqual([
      expect.objectContaining({ api_name: 'SearchAPI', reason: 'over_item_cap', detail: 'LLM_MAX_ITEMS=1' }),
    ]);
  });

  it('marks escalations in the prompt', async () => {
    const client = scriptedClient({ alerts: [goodSpecItem()] });
    await write(client, [req(specFinding(), { reasons: ['new_rules'], new_rules: ['LATENCY_CRITICAL'] })]);
    expect(JSON.parse(client.calls[0].userContent).items[0]).toMatchObject({
      is_escalation: true,
      new_rules: ['LATENCY_CRITICAL'],
    });
  });
});

describe('parseLlmResponse', () => {
  it('keeps the first answer per id and ignores junk entries', () => {
    const { byId } = parseLlmResponse(
      JSON.stringify({ alerts: [{ id: 'a1', title: 'first' }, { id: 'a1', title: 'second' }, null, 'x'] }),
    );
    expect([...byId.keys()]).toEqual(['a1']);
    expect(byId.get('a1').title).toBe('first');
  });
});

describe('acceptItem', () => {
  it('returns llm text for a valid, factual item', () => {
    expect(acceptItem(goodSpecItem(), specFinding())).toMatchObject({
      ok: true,
      message: { message_source: 'llm' },
    });
  });

  it('reports missing items', () => {
    expect(acceptItem(undefined, specFinding())).toMatchObject({ ok: false, reason: 'missing_item' });
  });
});
