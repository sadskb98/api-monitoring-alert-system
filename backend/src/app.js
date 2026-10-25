import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { createHealthController } from './controllers/health.controller.js';
import { createMonitorController } from './controllers/monitor.controller.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { REQUEST_ID_HEADER, requestId } from './middleware/requestId.js';
import { alertsRoutes } from './routes/alerts.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { monitorRoutes } from './routes/monitor.routes.js';
import { createMonitorService } from './services/monitor.service.js';

/**
 * Express app factory. Dependencies are injected so tests can supply
 * their own config, a silent logger, a fake DB connection and a monitor service with a fake LLM.
 */
export function createApp({
  config,
  logger,
  db = mongoose.connection,
  monitorService = createMonitorService({ config }),
}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'reqId' },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: [REQUEST_ID_HEADER] }));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use('/health', healthRoutes(createHealthController({ db, llmEnabled: config.llm.enabled })));
  app.use('/monitor', monitorRoutes(createMonitorController({ monitorService })));
  app.use('/alerts', alertsRoutes());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
