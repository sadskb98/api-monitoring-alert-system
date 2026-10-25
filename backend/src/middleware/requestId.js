import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Pure: reuse a well-formed incoming id, otherwise generate one. */
export function resolveRequestId(incoming, generate = randomUUID) {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
}

export function requestId() {
  return (req, res, next) => {
    req.id = resolveRequestId(req.get(REQUEST_ID_HEADER));
    res.setHeader(REQUEST_ID_HEADER, req.id);
    next();
  };
}
