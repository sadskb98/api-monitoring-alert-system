import { NotFoundError } from '../lib/errors.js';

export function notFound(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}
