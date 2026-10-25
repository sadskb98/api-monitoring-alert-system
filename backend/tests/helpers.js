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
