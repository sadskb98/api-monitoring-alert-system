import { z } from 'zod';
import { PayloadTooLargeError, ValidationError, formatZodIssues } from '../lib/errors.js';
import { fingerprintFor } from '../services/alerts/fingerprint.js';

const required = (expected) => (issue) => (issue.input === undefined ? 'Required' : `Expected ${expected}`);

/**
 * Identity: without a usable api_name (or with an unusable timestamp) a record
 * can't be attributed or ordered, so it is rejected rather than evaluated.
 */
export const identitySchema = z.object({
  api_name: z
    .string({ error: required('a string') })
    .trim()
    .min(1, 'Must not be empty')
    .max(100, 'Must be at most 100 characters')
    .regex(/^[A-Za-z0-9._ -]+$/, 'May only contain letters, digits, space, dot, underscore and dash'),
  timestamp: z.iso.datetime({ offset: true, error: 'Expected an ISO 8601 datetime' }).optional(),
});

/**
 * Metrics are validated field by field: a known API returning malformed metrics
 * is itself an anomaly (INVALID_PAYLOAD), so we keep valid fields and record invalid ones.
 */
export const metricSchemas = {
  response_time_ms: z.number({ error: required('a number') }).nonnegative('Must be >= 0'),
  status_code: z
    .number({ error: required('an integer') })
    .int('Expected an integer')
    .min(100, 'Must be a valid HTTP status (100-599)')
    .max(599, 'Must be a valid HTTP status (100-599)'),
  // null/absent is a legitimate value here: it means "records missing" (RECORDS_MISSING rule)
  records_returned: z
    .number({ error: 'Expected an integer' })
    .int('Expected an integer')
    .nonnegative('Must be >= 0')
    .nullable()
    .optional(),
};

/**
 * Pure: validate one raw record.
 * @returns {{ ok: true, observation } | { ok: false, issues }}
 */
export function parseObservation(raw, { index, receivedAt }) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'Expected an object' }] };
  }

  const identity = identitySchema.safeParse(raw);
  if (!identity.success) return { ok: false, issues: formatZodIssues(identity.error.issues) };

  const observation = {
    index,
    api_name: identity.data.api_name,
    fingerprint: fingerprintFor(identity.data.api_name),
    observed_at: identity.data.timestamp ? new Date(identity.data.timestamp) : receivedAt,
    invalid_fields: [],
  };
  for (const [field, schema] of Object.entries(metricSchemas)) {
    const result = schema.safeParse(raw[field]);
    if (result.success) {
      observation[field] = result.data ?? null;
    } else {
      observation[field] = null;
      observation.invalid_fields.push({ field, message: result.error.issues[0].message });
    }
  }
  return { ok: true, observation };
}

/**
 * Pure: validate a request body / file content into accepted observations and rejected records.
 * Accepts an array of records or a single record object.
 */
export function parseBatch(body, { maxBatchSize, receivedAt = new Date() }) {
  const records = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : null;
  if (!records) {
    throw new ValidationError('Body must be a JSON array of observations or a single observation object');
  }
  if (records.length === 0) throw new ValidationError('Batch must contain at least one observation');
  if (records.length > maxBatchSize) {
    throw new PayloadTooLargeError(`Batch exceeds the maximum of ${maxBatchSize} observations`, {
      max_batch_size: maxBatchSize,
      received: records.length,
    });
  }

  const accepted = [];
  const rejected = [];
  records.forEach((raw, index) => {
    const result = parseObservation(raw, { index, receivedAt });
    if (result.ok) accepted.push(result.observation);
    else rejected.push({ index, issues: result.issues });
  });
  return { received: records.length, accepted, rejected };
}
