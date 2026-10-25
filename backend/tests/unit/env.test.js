import { describe, expect, it } from 'vitest';
import { ConfigError, computeBodyLimitBytes, parseEnv } from '../../src/config/env.js';
import { BASE_ENV } from '../helpers.js';

const parse = (overrides = {}) => parseEnv({ ...BASE_ENV, ...overrides });

function issueKeys(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err.issues.map((i) => i.key);
  }
  throw new Error('expected ConfigError');
}

describe('parseEnv', () => {
  it('applies defaults', () => {
    const c = parse();
    expect(c.port).toBe(4000);
    expect(c.maxBatchSize).toBe(1000);
    expect(c.thresholds).toEqual({ latencyWarningMs: 2000, latencyCriticalMs: 5000 });
    expect(c.alerts.resolveAfterHealthy).toBe(1);
    expect(c.llm).toMatchObject({
      model: 'test-model',
      enabled: false,
      timeoutMs: 8000,
      maxRetries: 2,
      maxItems: 50,
    });
    expect(c.email).toMatchObject({ enabled: false, minSeverity: 'high', smtp: null });
    expect(c.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('requires GEMINI_MODEL with no default', () => {
    const { GEMINI_MODEL: _omit, ...withoutModel } = BASE_ENV;
    expect(issueKeys(() => parseEnv(withoutModel))).toContain('GEMINI_MODEL');
    expect(issueKeys(() => parse({ GEMINI_MODEL: '   ' }))).toContain('GEMINI_MODEL');
  });

  it('requires a mongodb URI', () => {
    expect(issueKeys(() => parse({ MONGODB_URI: 'http://nope' }))).toContain('MONGODB_URI');
    expect(parse({ MONGODB_URI: 'mongodb+srv://u:p@cluster.example/db' }).mongoUri).toMatch(/^mongodb\+srv/);
  });

  it('rejects warning threshold >= critical threshold', () => {
    expect(issueKeys(() => parse({ LATENCY_WARNING_MS: '5000', LATENCY_CRITICAL_MS: '5000' }))).toContain(
      'LATENCY_WARNING_MS',
    );
  });

  it('coerces numbers and booleans from strings', () => {
    const c = parse({
      PORT: '8080',
      EMAIL_ENABLED: 'true',
      EMAIL_TO: 'ops@example.com',
      MAX_BATCH_SIZE: '50',
    });
    expect(c.port).toBe(8080);
    expect(c.email.enabled).toBe(true);
    expect(c.maxBatchSize).toBe(50);
  });

  it('requires EMAIL_TO when email is enabled', () => {
    expect(issueKeys(() => parse({ EMAIL_ENABLED: 'true' }))).toContain('EMAIL_TO');
  });

  it('treats empty strings as unset', () => {
    const c = parse({ GEMINI_API_KEY: '', LOG_FILE: '', PORT: '' });
    expect(c.llm.enabled).toBe(false);
    expect(c.log.file).toBeUndefined();
    expect(c.port).toBe(4000);
  });

  it('enables the LLM when an API key is present', () => {
    expect(parse({ GEMINI_API_KEY: 'k' }).llm.enabled).toBe(true);
  });

  it('never includes secret values in the error message', () => {
    const secret = 'super-secret-key-123';
    try {
      parse({ GEMINI_API_KEY: secret, MONGODB_URI: `bad://${secret}`, PORT: 'abc' });
      throw new Error('expected ConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).not.toContain(secret);
      expect(err.message).toContain('MONGODB_URI');
      expect(err.message).toContain('PORT');
    }
  });

  it('returns a frozen config', () => {
    const c = parse();
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.llm)).toBe(true);
  });

  it('derives the JSON body limit from MAX_BATCH_SIZE', () => {
    expect(parse({ MAX_BATCH_SIZE: '1000' }).jsonBodyLimit).toBe(1000 * 1024);
  });
});

describe('computeBodyLimitBytes', () => {
  it('scales at 1 KB per record', () => {
    expect(computeBodyLimitBytes(1000)).toBe(1_024_000);
    expect(computeBodyLimitBytes(5000)).toBe(5_120_000);
  });

  it('never goes below 100 KB', () => {
    expect(computeBodyLimitBytes(1)).toBe(102_400);
    expect(computeBodyLimitBytes(100)).toBe(102_400);
  });
});
