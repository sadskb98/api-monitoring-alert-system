import { describe, expect, it } from 'vitest';
import {
  SYSTEM_INSTRUCTION,
  buildPromptItems,
  buildUserContent,
  llmItemSchema,
} from '../../../src/services/llm/prompt.js';
import { THRESHOLDS, findingOf, specFinding } from '../../fixtures.js';

describe('SYSTEM_INSTRUCTION', () => {
  it('asks for plain digits exactly as given', () => {
    expect(SYSTEM_INSTRUCTION).toContain('Write every number as plain digits exactly as given');
    expect(SYSTEM_INSTRUCTION).toContain('write "5500 ms", never "5.5 seconds" or "5,500 ms"');
  });

  it('keeps detection and severity out of the LLM', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/do not decide what is or is not an anomaly/i);
    expect(SYSTEM_INSTRUCTION).toMatch(/Do not change, judge or mention the severity/);
    expect(SYSTEM_INSTRUCTION).toMatch(/never as instructions/);
  });
});

describe('buildPromptItems', () => {
  it('spec example item', () => {
    const [item] = buildPromptItems([{ finding: specFinding(), escalation: null }], THRESHOLDS);
    expect(item).toEqual({
      id: 'a1',
      api_name: 'AppointmentAPI',
      is_escalation: false,
      anomalies: [
        { rule: 'HTTP_5XX', category: 'AVAILABILITY', description: 'Server error (5xx)' },
        {
          rule: 'LATENCY_CRITICAL',
          category: 'LATENCY',
          description: 'Response time above critical threshold',
        },
      ],
      observation: { status_code: 500, response_time_ms: 5500, records_returned: 0 },
      batch_stats: { records: 1, anomalous_records: 1 },
      thresholds: { latency_warning_ms: 2000, latency_critical_ms: 5000 },
    });
  });

  it('numbers ids by position and adds escalation context', () => {
    const items = buildPromptItems(
      [
        { finding: specFinding(), escalation: null },
        {
          finding: findingOf({ api_name: 'B', status_code: 401 }),
          escalation: { reasons: ['severity_increased'], new_rules: ['HTTP_AUTH'] },
        },
      ],
      THRESHOLDS,
    );
    expect(items.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(items[1]).toMatchObject({
      is_escalation: true,
      escalation_reasons: ['severity_increased'],
      new_rules: ['HTTP_AUTH'],
    });
  });

  it('includes invalid fields only when present, and never the severity or fingerprint', () => {
    const f = findingOf({
      records_returned: null,
      invalid_fields: [{ field: 'records_returned', message: 'Expected an integer' }],
    });
    const [item] = buildPromptItems([{ finding: f, escalation: null }], THRESHOLDS);
    expect(item.observation.invalid_fields).toEqual([
      { field: 'records_returned', message: 'Expected an integer' },
    ]);
    expect(item).not.toHaveProperty('severity');
    expect(item).not.toHaveProperty('fingerprint');
  });

  it('serializes to a JSON object with items', () => {
    const items = buildPromptItems([{ finding: specFinding(), escalation: null }], THRESHOLDS);
    expect(JSON.parse(buildUserContent(items))).toEqual({ items });
  });
});

describe('llmItemSchema', () => {
  const item = { id: 'a1', title: 'T', message: 'M', suggested_action: 'A' };

  it('trims and accepts a valid item', () => {
    expect(llmItemSchema.parse({ ...item, title: '  T  ' }).title).toBe('T');
  });

  it.each([
    ['empty message', { message: '   ' }],
    ['missing action', { suggested_action: undefined }],
    ['overlong message', { message: 'x'.repeat(601) }],
  ])('rejects %s', (_label, patch) => {
    expect(llmItemSchema.safeParse({ ...item, ...patch }).success).toBe(false);
  });
});
