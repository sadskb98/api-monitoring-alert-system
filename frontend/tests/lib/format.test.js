import { describe, expect, it } from 'vitest';
import { displayTitle, formatMs, formatValue, relativeTime, shortId } from '../../src/lib/format.js';

describe('relativeTime', () => {
  const now = new Date('2026-10-26T12:00:00Z').getTime();
  const ago = (s) => new Date(now - s * 1000).toISOString();

  it('buckets into just now / seconds / minutes / hours / days', () => {
    expect(relativeTime(ago(2), now)).toBe('just now');
    expect(relativeTime(ago(42), now)).toBe('42s ago');
    expect(relativeTime(ago(5 * 60 + 10), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3600), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86400 + 5), now)).toBe('2d ago');
  });

  it('accepts epoch milliseconds and treats future times as now', () => {
    expect(relativeTime(now - 30_000, now)).toBe('30s ago');
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });

  it('shows a dash for missing or invalid values', () => {
    expect(relativeTime(null, now)).toBe('—');
    expect(relativeTime('not a date', now)).toBe('—');
  });
});

describe('formatting helpers', () => {
  it('formats milliseconds as plain digits, like the alert text', () => {
    expect(formatMs(5500)).toBe('5500 ms');
    expect(formatMs(null)).toBe('—');
  });

  it('formats nullable values, keeping zero', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(undefined)).toBe('—');
  });

  it('shortens long ids only', () => {
    expect(shortId('65f2a1b2c3d4e5f6a7b8c9d0')).toBe('65f2a1…c9d0');
    expect(shortId('req-1')).toBe('req-1');
    expect(shortId(null)).toBe('');
  });
});

describe('displayTitle', () => {
  it('drops the leading API name and separator', () => {
    expect(displayTitle('AppointmentAPI: server errors, critical latency', 'AppointmentAPI')).toBe(
      'Server errors, critical latency',
    );
    expect(displayTitle('AppointmentAPI - Outage', 'AppointmentAPI')).toBe('Outage');
    expect(displayTitle('appointmentapi returning 500s', 'AppointmentAPI')).toBe('Returning 500s');
  });

  it('keeps titles that do not start with the name, or are only the name', () => {
    expect(displayTitle('Outage on AppointmentAPI', 'AppointmentAPI')).toBe('Outage on AppointmentAPI');
    expect(displayTitle('AppointmentAPI', 'AppointmentAPI')).toBe('AppointmentAPI');
  });
});
