import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../../src/middleware/requestId.js';

describe('resolveRequestId', () => {
  const gen = () => 'generated';

  it('reuses a well-formed incoming id', () => {
    expect(resolveRequestId('abc-123_x.y', gen)).toBe('abc-123_x.y');
  });

  it('generates an id when missing or unsafe', () => {
    expect(resolveRequestId(undefined, gen)).toBe('generated');
    expect(resolveRequestId('', gen)).toBe('generated');
    expect(resolveRequestId('bad id\nwith newline', gen)).toBe('generated');
    expect(resolveRequestId('x'.repeat(129), gen)).toBe('generated');
  });
});
