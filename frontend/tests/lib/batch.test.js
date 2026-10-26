import { describe, expect, it } from 'vitest';
import { checkBatchText, describeLlm } from '../../src/lib/batch.js';
import { SAMPLES } from '../../src/components/samples.js';

describe('checkBatchText', () => {
  it('accepts an array and counts its records', () => {
    expect(checkBatchText('[{"api_name":"A"},{"api_name":"B"}]')).toEqual({ ok: true, count: 2 });
  });

  it('accepts a single observation object', () => {
    expect(checkBatchText('{"api_name":"A"}')).toEqual({ ok: true, count: 1 });
  });

  it('rejects empty text, an empty array and non-object JSON', () => {
    expect(checkBatchText('  ')).toMatchObject({ ok: false, message: 'Paste a batch or load a sample' });
    expect(checkBatchText('[]')).toMatchObject({ ok: false, message: 'The batch is empty' });
    expect(checkBatchText('42')).toMatchObject({ ok: false });
    expect(checkBatchText('null')).toMatchObject({ ok: false });
  });

  it('reports invalid JSON with the line when the engine gives a position', () => {
    const result = checkBatchText('[\n  {"api_name": "A",\n  }\n]');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Invalid JSON: .*line 3/);
  });

  it('keeps invalid-JSON messages on one line', () => {
    const result = checkBatchText('[\n  {"api_name": }\n]');
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/^Invalid JSON: /) });
    expect(result.message).not.toMatch(/\n/);
  });

  it('every bundled sample is valid', () => {
    for (const sample of SAMPLES) expect(checkBatchText(sample.text).ok).toBe(true);
  });
});

describe('SAMPLES', () => {
  it('Mixed includes a record without api_name and one with a malformed field', () => {
    const mixed = JSON.parse(SAMPLES.find((s) => s.id === 'mixed').text);
    expect(mixed.some((r) => !('api_name' in r))).toBe(true);
    expect(mixed.some((r) => r.response_time_ms === 'fast')).toBe(true);
  });
});

describe('describeLlm', () => {
  it('describes each LLM outcome', () => {
    expect(describeLlm({ status: 'ok', model: 'gemini-3.7-flash', attempts: 1, latency_ms: 1840 })).toEqual({
      tone: 'ai',
      label: 'AI-generated',
      detail: 'gemini-3.7-flash · 1840 ms',
    });
    expect(describeLlm({ status: 'ok', model: 'm', attempts: 2, latency_ms: 10 }).detail).toBe(
      'm · 10 ms · 2 attempts',
    );
    expect(describeLlm({ status: 'fallback', attempts: 3 })).toMatchObject({
      tone: 'warn',
      detail: '3 attempts',
    });
    expect(describeLlm({ status: 'disabled' }).label).toBe('Templates (LLM disabled)');
    expect(describeLlm({ status: 'skipped' }).label).toBe('No new alert text needed');
    expect(describeLlm({ status: 'partial', model: 'm', attempts: 1, latency_ms: 5 }).tone).toBe('warn');
  });
});
