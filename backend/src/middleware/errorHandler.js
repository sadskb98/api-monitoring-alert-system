import { ZodError } from 'zod';
import {
  AppError,
  InvalidJsonError,
  PayloadTooLargeError,
  ValidationError,
  formatZodIssues,
  toErrorBody,
} from '../lib/errors.js';

/** Pure: map any thrown value to an AppError. */
export function normalizeError(err) {
  if (err instanceof AppError) return err;
  if (err?.type === 'entity.too.large') {
    return new PayloadTooLargeError('Request payload is too large', { limit_bytes: err.limit });
  }
  if (err?.type === 'entity.parse.failed') return new InvalidJsonError();
  if (err instanceof ZodError) {
    return new ValidationError('Validation failed', formatZodIssues(err.issues));
  }
  return new AppError();
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const appError = normalizeError(err);
  const log = req.log ?? console;
  if (appError.status >= 500) {
    log.error({ err }, 'Unhandled error');
  } else {
    log.warn({ code: appError.code, status: appError.status }, appError.message);
  }

  res.status(appError.status).json(toErrorBody(appError));
}
