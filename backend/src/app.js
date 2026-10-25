import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { createHealthController } from './controllers/health.controller.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { REQUEST_ID_HEADER, requestId } from './middleware/requestId.js';
import { healthRoutes } from './routes/health.routes.js';

/**
 * Express app factory. Dependencies are injected so tests can supply
 * their own config, a silent logger and a fake DB connection.
 */
export function createApp({ config, logger, db = mongoose.connection }) {
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

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
