import { Router } from 'express';
import * as controller from '../controllers/alerts.controller.js';
import { validate } from '../middleware/validate.js';
import { alertIdParams, listAlertsQuery, updateAlertBody } from '../schemas/alerts.schema.js';

export function alertsRoutes() {
  const router = Router();
  router.get('/', validate({ query: listAlertsQuery }), controller.list);
  router.get('/:id', validate({ params: alertIdParams }), controller.show);
  router.patch('/:id', validate({ params: alertIdParams, body: updateAlertBody }), controller.update);
  return router;
}
