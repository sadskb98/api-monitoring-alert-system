import pino from 'pino';
import { parseEnv } from '../src/config/env.js';

export const BASE_ENV = Object.freeze({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/api-monitor-test',
  GEMINI_MODEL: 'test-model',
});

export function testConfig(overrides = {}) {
  return parseEnv({ ...BASE_ENV, ...overrides });
}

export const silentLogger = pino({ level: 'silent' });

export const fakeDb = (readyState = 1) => ({ readyState });

const PINO_FIELDS = new Set(['level', 'time', 'pid', 'hostname', 'msg']);

/**
 * Real pino logger (pino-http needs one) that keeps entries in memory.
 * `warnings(msg)` returns the bindings of warn entries with that message, minus pino's own fields.
 */
export function captureLogger() {
  const entries = [];
  const log = pino({ level: 'debug' }, { write: (line) => entries.push(JSON.parse(line)) });
  const bindingsOf = (entry) =>
    Object.fromEntries(Object.entries(entry).filter(([k]) => !PINO_FIELDS.has(k)));
  const warnings = (msg) =>
    entries.filter((e) => e.level === pino.levels.values.warn && e.msg === msg).map(bindingsOf);
  return { log, entries, warnings };
}
