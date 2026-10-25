import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotFoundError, formatZodIssues } from '../../src/lib/errors.js';
import { errorHandler, normalizeError } from '../../src/middleware/errorHandler.js';

function mockRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
const mockReq = () => ({ log: { error: vi.fn(), warn: vi.fn() } });

describe('normalizeError', () => {
  it('passes AppErrors through', () => {
    const err = new NotFoundError('nope');
    expect(normalizeError(err)).toBe(err);
  });

  it('maps body-parser size errors to 413', () => {
    const e = normalizeError({ type: 'entity.too.large', limit: 1024 });
    expect(e).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE', details: { limit_bytes: 1024 } });
  });

  it('maps body-parser parse errors to 400 INVALID_JSON', () => {
    expect(normalizeError({ type: 'entity.parse.failed' })).toMatchObject({
      status: 400,
      code: 'INVALID_JSON',
    });
  });

  it('maps ZodErrors to 400 VALIDATION_ERROR', () => {
    const { error } = z.object({ a: z.number() }).safeParse({ a: 'x' });
    const e = normalizeError(error);
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(e.details[0].path).toBe('a');
  });

  it('hides unknown errors behind a generic 500', () => {
    const e = normalizeError(new Error('db password is hunter2'));
    expect(e).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });
});

describe('errorHandler', () => {
  it('writes the canonical error shape', () => {
    const res = mockRes();
    errorHandler(new NotFoundError('Alert not found', { id: '1' }), mockReq(), res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Alert not found', details: { id: '1' } },
    });
  });

  it('logs 5xx at error level and 4xx at warn level', () => {
    const req = mockReq();
    errorHandler(new Error('boom'), req, mockRes(), vi.fn());
    errorHandler(new NotFoundError(), req, mockRes(), vi.fn());
    expect(req.log.error).toHaveBeenCalledTimes(1);
    expect(req.log.warn).toHaveBeenCalledTimes(1);
  });

  it('delegates when headers were already sent', () => {
    const next = vi.fn();
    const res = { ...mockRes(), headersSent: true };
    const err = new Error('late');
    errorHandler(err, mockReq(), res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('formatZodIssues', () => {
  it('joins nested paths', () => {
    const { error } = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: { b: 1 } });
    expect(formatZodIssues(error.issues)).toEqual([{ path: 'a.b', message: expect.any(String) }]);
  });
});
