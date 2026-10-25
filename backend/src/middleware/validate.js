import { ValidationError, formatZodIssues } from '../lib/errors.js';

const PARTS = ['params', 'query', 'body'];

/**
 * Validate request parts with zod schemas. Parsed values land on req.validated
 * (Express 5's req.query is read-only, so we never overwrite request props).
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    for (const part of PARTS) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part]);
      if (!result.success) {
        return next(new ValidationError(`Invalid request ${part}`, formatZodIssues(result.error.issues)));
      }
      validated[part] = result.data;
    }
    req.validated = validated;
    next();
  };
}
