export class AppError extends Error {
  constructor({
    status = 500,
    code = 'INTERNAL_ERROR',
    message = 'Internal server error',
    details = null,
  } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details = null) {
    super({ status: 400, code: 'VALIDATION_ERROR', message, details });
  }
}

export class InvalidJsonError extends AppError {
  constructor(message = 'Request body is not valid JSON') {
    super({ status: 400, code: 'INVALID_JSON', message });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null) {
    super({ status: 404, code: 'NOT_FOUND', message, details });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Request payload is too large', details = null) {
    super({ status: 413, code: 'PAYLOAD_TOO_LARGE', message, details });
  }
}

/** Pure: zod issues -> [{ path, message }] for error details. */
export function formatZodIssues(issues) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Pure: build the canonical error response body. */
export function toErrorBody({ code, message, details = null }) {
  return { error: { code, message, details } };
}
