import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { acceptItem, createAlertWriter, parseLlmResponse } from '../../../src/services/llm/alertWriter.js';
import { LlmTimeoutError } from '../../../src/services/llm/geminiClient.js';
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
    calls,
    async generateJson(args) {
      calls.push(args);
      const next = script.length > 1 ? script.shift() : script[0];
      if (next instanceof Error) throw next;
      return typeof next === 'string' ? next : JSON.stringify(next);
    },
  };
}

function writerWith(client, llm = {}) {
  const sleeps = [];
  const writer = createAlertWriter({
    llm: { ...LLM, ...llm },
    thresholds: THRESHOLDS,
    client,
    sleep: async (ms) => sleeps.push(ms),
    random: () => 1,
  });
  return { writer, sleeps };
}

async function write(client, requests, llm) {
  const { writer, sleeps } = writerWith(client, llm);
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
    expect(llm).toEqual({ status: 'skipped', attempts: 0, latency_ms: null, fallbacks: [] });
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
        detail: expect.stringMatching(/^status 503 after 3 attempt\(s\): .*UNAVAILABLE/),
      }),
    ]);
  });

  it('retries timeouts', async () => {
    const client = scriptedClient(new LlmTimeoutError(8000), { alerts: [goodSpecItem()] });
    const { llm } = await write(client, [req(specFinding())]);
    expect(llm).toMatchObject({ status: 'ok', attempts: 2 });
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
