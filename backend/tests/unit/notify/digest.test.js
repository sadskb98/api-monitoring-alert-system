import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  digestSubject,
  escapeHtml,
  selectForDigest,
} from '../../../src/services/notify/digest.js';

const item = (overrides = {}) => ({
  alert_id: 'a1',
  api_name: 'AppointmentAPI',
  action: 'created',
  status: 'active',
  severity: 'critical',
  anomalies: [
    { rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' },
    { rule: 'LATENCY_CRITICAL', category: 'LATENCY', severity: 'high' },
  ],
  title: 'AppointmentAPI: server errors, critical latency',
  message: 'AppointmentAPI failed with status 500, returned 0 records and responded in 5500 ms.',
  suggested_action: 'Check service logs.',
  message_source: 'llm',
  message_model: 'gemini-3.7-flash',
  ...overrides,
});

describe('selectForDigest', () => {
  it('keeps created and escalated alerts at or above the minimum, most severe first', () => {
    const items = [
      item({ alert_id: 'm', api_name: 'M', severity: 'medium' }),
      item({ alert_id: 'h', api_name: 'H', severity: 'high', action: 'escalated' }),
      item({ alert_id: 'c', api_name: 'C', severity: 'critical' }),
    ];
    expect(selectForDigest(items, 'high').map((i) => i.alert_id)).toEqual(['c', 'h']);
    expect(selectForDigest(items, 'medium').map((i) => i.alert_id)).toEqual(['c', 'h', 'm']);
  });

  it('never includes touched or resolved alerts', () => {
    const items = [item({ action: 'updated' }), item({ action: 'resolved', status: 'resolved' })];
    expect(selectForDigest(items, 'low')).toEqual([]);
  });
});

describe('digestSubject', () => {
  it('uses the alert itself for a single alert', () => {
    expect(digestSubject([item()])).toBe(
      '[API Monitor] CRITICAL AppointmentAPI: server errors, critical latency',
    );
  });

  it('summarizes counts by severity for several alerts', () => {
    const items = [item(), item({ severity: 'high' }), item({ severity: 'high' })];
    expect(digestSubject(items)).toBe('[API Monitor] 3 alerts (1 critical, 2 high)');
  });
});

describe('buildDigest', () => {
  const batch = { batch_id: 'b1', source: 'http', min_severity: 'high' };

  it('renders a text body with every alert field the on-call engineer needs', () => {
    const { text } = buildDigest([item()], batch);
    expect(text).toContain('1 alert(s) at or above high from batch b1 (http).');
    expect(text).toContain('[CRITICAL] AppointmentAPI - created');
    expect(text).toContain('responded in 5500 ms');
    expect(text).toContain('Suggested action: Check service logs.');
    expect(text).toContain('Anomalies: HTTP_5XX (critical), LATENCY_CRITICAL (high)');
    expect(text).toContain('Text: AI-generated (gemini-3.7-flash) | Alert id: a1');
  });

  it('labels template text', () => {
    const { text } = buildDigest([item({ message_source: 'template', message_model: null })], batch);
    expect(text).toContain('Text: Template');
  });

  it('escapes alert content in the HTML body', () => {
    const { html } = buildDigest([item({ message: '<script>alert(1)</script> & "x"' })], batch);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
