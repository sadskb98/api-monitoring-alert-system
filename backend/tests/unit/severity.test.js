import { describe, expect, it } from 'vitest';
import { compareSeverity, isAtLeast, maxSeverity, severityRank } from '../../src/lib/severity.js';

describe('severity helpers', () => {
  it('ranks low < medium < high < critical', () => {
    expect(severityRank('low')).toBeLessThan(severityRank('medium'));
    expect(severityRank('medium')).toBeLessThan(severityRank('high'));
    expect(severityRank('high')).toBeLessThan(severityRank('critical'));
  });

  it('throws on unknown severity', () => {
    expect(() => severityRank('urgent')).toThrow(TypeError);
  });

  it('compares severities', () => {
    expect(compareSeverity('critical', 'high')).toBeGreaterThan(0);
    expect(compareSeverity('medium', 'medium')).toBe(0);
  });

  it('finds the max severity', () => {
    expect(maxSeverity(['medium', 'critical', 'high'])).toBe('critical');
    expect(maxSeverity([])).toBeNull();
  });

  it('checks minimum severity', () => {
    expect(isAtLeast('critical', 'high')).toBe(true);
    expect(isAtLeast('high', 'high')).toBe(true);
    expect(isAtLeast('medium', 'high')).toBe(false);
  });
});
