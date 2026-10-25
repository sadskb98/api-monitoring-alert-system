import { z } from 'zod';
import { SEVERITIES } from '../lib/severity.js';

/** Gemini thinkingConfig.thinkingLevel values; the lowest one supported is model dependent. */
export const THINKING_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high']);

const KB = 1024;
const MIN_BODY_LIMIT_BYTES = 100 * KB;
// Spec records are ~120 bytes; 1 KB per record leaves ample headroom for longer names/extra fields.
const BODY_BYTES_PER_RECORD = KB;

export class ConfigError extends Error {
  constructor(issues) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const int = (opts = {}) => {
  let s = z.coerce.number().int();
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  return s;
};

const envObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int({ min: 1, max: 65535 }).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_FILE: z.string().optional(),

  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  MAX_BATCH_SIZE: int({ min: 1, max: 10000 }).default(1000),
  LATENCY_WARNING_MS: int({ min: 1 }).default(2000),
  LATENCY_CRITICAL_MS: int({ min: 1 }).default(5000),
  ALERT_RESOLVE_AFTER_HEALTHY: int({ min: 1 }).default(1),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string({ error: 'is required' }).min(1, 'is required'),
  GEMINI_FALLBACK_MODELS: z.string().optional(),
  LLM_TIMEOUT_MS: int({ min: 100 }).default(8000),
  LLM_MAX_RETRIES: int({ min: 0, max: 5 }).default(2),
  LLM_MAX_ITEMS: int({ min: 1, max: 500 }).default(50),
  LLM_THINKING_LEVEL: z.enum(THINKING_LEVELS).default('minimal'),

  EMAIL_ENABLED: z.stringbool().default(false),
  EMAIL_MIN_SEVERITY: z.enum(SEVERITIES).default('high'),
  EMAIL_FROM: z.string().optional(),
  EMAIL_TO: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int({ min: 1, max: 65535 }).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

const envSchema = envObject.superRefine((env, ctx) => {
  if (env.LATENCY_WARNING_MS >= env.LATENCY_CRITICAL_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['LATENCY_WARNING_MS'],
      message: 'must be lower than LATENCY_CRITICAL_MS',
    });
  }
  if (env.EMAIL_ENABLED && !env.EMAIL_TO) {
    ctx.addIssue({ code: 'custom', path: ['EMAIL_TO'], message: 'is required when EMAIL_ENABLED=true' });
  }
});

/** Pure: JSON body limit (bytes) scaled to the configured batch size. */
export function computeBodyLimitBytes(maxBatchSize) {
  return Math.max(MIN_BODY_LIMIT_BYTES, maxBatchSize * BODY_BYTES_PER_RECORD);
}

/** Pure: comma-separated fallback models -> unique list, without blanks or the primary model. */
export function parseFallbackModels(value, primary) {
  const models = (value ?? '').split(',').map((m) => m.trim());
  return [...new Set(models)].filter((m) => m && m !== primary);
}

/** Pick only known keys and treat empty strings as unset (common in .env files). */
function pickDefined(source) {
  const out = {};
  for (const key of Object.keys(envObject.shape)) {
    const value = source[key];
    if (value !== undefined && String(value).trim() !== '') out[key] = String(value).trim();
  }
  return out;
}

/**
 * Pure: validate an env-like object and return a frozen config.
 * Throws ConfigError listing offending keys; never includes values (they may be secrets).
 */
export function parseEnv(source = process.env) {
  const result = envSchema.safeParse(pickDefined(source));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => ({ key: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  const e = result.data;

  return deepFreeze({
    env: e.NODE_ENV,
    isDev: e.NODE_ENV === 'development',
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    log: { level: e.LOG_LEVEL, file: e.LOG_FILE },
    mongoUri: e.MONGODB_URI,
    corsOrigins: e.CORS_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxBatchSize: e.MAX_BATCH_SIZE,
    jsonBodyLimit: computeBodyLimitBytes(e.MAX_BATCH_SIZE),
    thresholds: {
      latencyWarningMs: e.LATENCY_WARNING_MS,
      latencyCriticalMs: e.LATENCY_CRITICAL_MS,
    },
    alerts: { resolveAfterHealthy: e.ALERT_RESOLVE_AFTER_HEALTHY },
    llm: {
      enabled: Boolean(e.GEMINI_API_KEY),
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      fallbackModels: parseFallbackModels(e.GEMINI_FALLBACK_MODELS, e.GEMINI_MODEL),
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxRetries: e.LLM_MAX_RETRIES,
      maxItems: e.LLM_MAX_ITEMS,
      thinkingLevel: e.LLM_THINKING_LEVEL,
    },
    email: {
      enabled: e.EMAIL_ENABLED,
      minSeverity: e.EMAIL_MIN_SEVERITY,
      from: e.EMAIL_FROM ?? 'API Monitor <alerts@api-monitor.local>',
      to: e.EMAIL_TO,
      smtp: e.SMTP_HOST
        ? { host: e.SMTP_HOST, port: e.SMTP_PORT ?? 587, user: e.SMTP_USER, pass: e.SMTP_PASS }
        : null, // null -> Ethereal test account in dev
    },
  });
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}
