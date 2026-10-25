import { describe, expect, it } from 'vitest';
import {
  escalationReasons,
  isNewRule,
  needsMessage,
  nextPeakSeverity,
  nextSeenRules,
  planBatch,
} from '../../../src/services/alerts/dedup.js';
import { anomaly } from '../../../src/services/detection/rules.js';

const finding = (fingerprint, rules, extra = {}) => {
  const anomalies = rules.map(anomaly);
  const order = ['low', 'medium', 'high', 'critical'];
  const severity = anomalies.reduce(
    (m, a) => (order.indexOf(a.severity) > order.indexOf(m) ? a.severity : m),
    'low',
  );
  return { fingerprint, api_name: fingerprint, anomalies, severity, ...extra };
};
const alert = (fingerprint, { severity, seen_rules, healthy_streak = 0, peak_severity = severity }) => ({
  _id: `id-${fingerprint}`,
  fingerprint,
  severity,
  peak_severity,
  seen_rules,
  healthy_streak,
});
const healthyEntry = (fingerprint, healthy_records = 1) => ({
  fingerprint,
  api_name: fingerprint,
  healthy_records,
});

describe('isNewRule', () => {
  it('is false for a rule already seen', () => {
    expect(isNewRule('HTTP_5XX', ['HTTP_5XX'])).toBe(false);
  });

  it('is true for a rule in a category never seen', () => {
    expect(isNewRule('ZERO_RECORDS', ['HTTP_5XX'])).toBe(true);
  });

  it('is true for a same-category upgrade', () => {
    expect(isNewRule('LATENCY_CRITICAL', ['LATENCY_WARNING'])).toBe(true);
  });

  it('is false for a same-category downgrade (improvement)', () => {
    expect(isNewRule('LATENCY_WARNING', ['LATENCY_CRITICAL'])).toBe(false);
    expect(isNewRule('ZERO_RECORDS', ['RECORDS_MISSING'])).toBe(false);
  });

  it('treats a different rule of equal severity in the same category as not new', () => {
    // HTTP_AUTH and HTTP_4XX are both high/AVAILABILITY: switching between them is not "new"
    expect(isNewRule('HTTP_4XX', ['HTTP_AUTH'])).toBe(false);
  });

  it('is true for a lower-severity rule in a different category', () => {
    expect(isNewRule('LATENCY_WARNING', ['HTTP_5XX'])).toBe(true);
  });
});

describe('escalationReasons', () => {
  it('detects a severity increase', () => {
    const a = alert('x', { severity: 'high', seen_rules: ['LATENCY_CRITICAL'] });
    expect(escalationReasons(a, finding('x', ['HTTP_5XX', 'LATENCY_CRITICAL'])).reasons).toEqual([
      'severity_increased',
      'new_rules',
    ]);
  });

  it('detects a new rule without a severity increase', () => {
    const a = alert('x', { severity: 'critical', seen_rules: ['HTTP_5XX'] });
    const r = escalationReasons(a, finding('x', ['HTTP_5XX', 'LATENCY_WARNING']));
    expect(r).toEqual({ reasons: ['new_rules'], newRules: ['LATENCY_WARNING'] });
  });

  it('detects a severity increase back to a previously seen rule', () => {
    const a = alert('x', {
      severity: 'high',
      peak_severity: 'critical',
      seen_rules: ['HTTP_5XX', 'LATENCY_CRITICAL'],
    });
    expect(escalationReasons(a, finding('x', ['HTTP_5XX'])).reasons).toEqual(['severity_increased']);
  });

  it('returns no reasons for the same or improved picture', () => {
    const a = alert('x', { severity: 'critical', seen_rules: ['HTTP_5XX', 'LATENCY_CRITICAL'] });
    expect(escalationReasons(a, finding('x', ['HTTP_5XX', 'LATENCY_CRITICAL'])).reasons).toEqual([]);
    expect(escalationReasons(a, finding('x', ['LATENCY_WARNING'])).reasons).toEqual([]);
  });
});

describe('planBatch', () => {
  const plan = (args) =>
    planBatch({ findings: [], healthy: [], activeAlerts: [], resolveAfterHealthy: 1, ...args });

  it('creates an alert for a finding without an active alert', () => {
    const f = finding('a', ['HTTP_5XX']);
    expect(plan({ findings: [f] }).create).toEqual([{ finding: f }]);
  });

  it('escalates when severity rises or a new rule appears', () => {
    const f = finding('a', ['HTTP_5XX']);
    const a = alert('a', { severity: 'medium', seen_rules: ['ZERO_RECORDS'] });
    const p = plan({ findings: [f], activeAlerts: [a] });
    expect(p.escalate).toEqual([
      { alert: a, finding: f, reasons: ['severity_increased', 'new_rules'], newRules: ['HTTP_5XX'] },
    ]);
    expect(p.create).toEqual([]);
  });

  it('touches when nothing new happened', () => {
    const f = finding('a', ['HTTP_5XX']);
    const a = alert('a', { severity: 'critical', seen_rules: ['HTTP_5XX'] });
    expect(plan({ findings: [f], activeAlerts: [a] }).touch).toEqual([{ alert: a, finding: f }]);
  });

  it('touches (does not escalate) when severity drops', () => {
    const f = finding('a', ['LATENCY_WARNING']);
    const a = alert('a', { severity: 'high', seen_rules: ['LATENCY_CRITICAL'] });
    const p = plan({ findings: [f], activeAlerts: [a] });
    expect(p.touch).toHaveLength(1);
    expect(p.escalate).toEqual([]);
  });

  it('auto-resolves an active alert on a healthy observation (threshold 1)', () => {
    const a = alert('a', { severity: 'critical', seen_rules: ['HTTP_5XX'] });
    const e = healthyEntry('a');
    expect(plan({ healthy: [e], activeAlerts: [a] }).resolve).toEqual([{ alert: a, entry: e, streak: 1 }]);
  });

  it('accumulates a healthy streak until ALERT_RESOLVE_AFTER_HEALTHY is reached', () => {
    const a = alert('a', { severity: 'critical', seen_rules: ['HTTP_5XX'], healthy_streak: 1 });
    const first = plan({ healthy: [healthyEntry('a', 1)], activeAlerts: [a], resolveAfterHealthy: 3 });
    expect(first.healthy).toEqual([expect.objectContaining({ streak: 2 })]);
    expect(first.resolve).toEqual([]);

    const second = plan({ healthy: [healthyEntry('a', 2)], activeAlerts: [a], resolveAfterHealthy: 3 });
    expect(second.resolve).toEqual([expect.objectContaining({ streak: 3 })]);
  });

  it('ignores healthy APIs without an active alert', () => {
    const p = plan({ healthy: [healthyEntry('a')] });
    expect(Object.values(p).flat()).toEqual([]);
  });

  it('leaves alerts for APIs absent from the batch untouched', () => {
    const a = alert('absent', { severity: 'critical', seen_rules: ['HTTP_5XX'] });
    const p = plan({ findings: [finding('other', ['HTTP_5XX'])], activeAlerts: [a] });
    expect(p.create).toHaveLength(1);
    expect([...p.escalate, ...p.touch, ...p.healthy, ...p.resolve]).toEqual([]);
  });

  it('handles many APIs in one batch', () => {
    const p = plan({
      findings: [
        finding('new', ['HTTP_5XX']),
        finding('same', ['ZERO_RECORDS']),
        finding('worse', ['HTTP_5XX']),
      ],
      healthy: [healthyEntry('recovered')],
      activeAlerts: [
        alert('same', { severity: 'medium', seen_rules: ['ZERO_RECORDS'] }),
        alert('worse', { severity: 'medium', seen_rules: ['ZERO_RECORDS'] }),
        alert('recovered', { severity: 'high', seen_rules: ['HTTP_AUTH'] }),
      ],
    });
    const fps = (list) => list.map((x) => (x.finding ?? x.alert).fingerprint);
    expect(fps(p.create)).toEqual(['new']);
    expect(fps(p.touch)).toEqual(['same']);
    expect(fps(p.escalate)).toEqual(['worse']);
    expect(fps(p.resolve)).toEqual(['recovered']);
  });
});

describe('helpers', () => {
  it('needsMessage returns findings for creates and escalations only', () => {
    const p = {
      create: [{ finding: { fingerprint: 'c' } }],
      escalate: [{ finding: { fingerprint: 'e' } }],
      touch: [{ finding: { fingerprint: 't' } }],
      healthy: [],
      resolve: [],
    };
    expect(needsMessage(p).map((f) => f.fingerprint)).toEqual(['c', 'e']);
  });

  it('peak severity never decreases', () => {
    expect(nextPeakSeverity({ peak_severity: 'critical' }, { severity: 'medium' })).toBe('critical');
    expect(nextPeakSeverity({ peak_severity: 'medium' }, { severity: 'high' })).toBe('high');
  });

  it('seen_rules is a stable union', () => {
    expect(
      nextSeenRules({ seen_rules: ['HTTP_5XX'] }, finding('x', ['LATENCY_WARNING', 'HTTP_5XX'])),
    ).toEqual(['HTTP_5XX', 'LATENCY_WARNING']);
  });
});
