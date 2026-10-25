import { Router } from 'express';

// Body validation lives in parseBatch: malformed records are reported per index, not rejected wholesale.
export function monitorRoutes(controller) {
  const router = Router();
  router.post('/', controller.create);
  return router;
}
