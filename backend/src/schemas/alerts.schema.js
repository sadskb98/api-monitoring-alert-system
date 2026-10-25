import { z } from 'zod';
import { SEVERITIES } from '../lib/severity.js';
import { RULES } from '../services/detection/rules.js';

const csv = (item) =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item));

export const listAlertsQuery = z.object({
  status: z.enum(['active', 'resolved', 'all']).default('active'),
  severity: csv(z.enum(SEVERITIES)).default([]),
  api_name: z.string().trim().min(1).max(100).optional(),
  rule: z.enum(Object.keys(RULES)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['severity', 'last_seen']).default('severity'),
});

export const alertIdParams = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'Must be a 24-character hex id'),
});

export const updateAlertBody = z.strictObject({
  status: z.literal('resolved', { error: 'Only { "status": "resolved" } is supported' }),
});
