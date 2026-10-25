import { Router } from 'express';

export function healthRoutes(controller) {
  const router = Router();
  router.get('/', controller.show);
  return router;
}
