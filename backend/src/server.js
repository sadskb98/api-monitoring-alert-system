import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { ConfigError, parseEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';

dotenv.config({ quiet: true });

function loadConfigOrExit() {
  try {
    return parseEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message); // lists keys only, never values
      process.exit(1);
    }
    throw err;
  }
}

async function main() {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.log.level, isDev: config.isDev, file: config.log.file });

  if (!config.llm.enabled) {
    logger.warn('GEMINI_API_KEY not set: LLM disabled, alerts will use template messages');
  }

  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
    logger.info('Connected to MongoDB');
  } catch (err) {
    logger.fatal({ errName: err.name, errMessage: err.message }, 'Failed to connect to MongoDB');
    process.exit(1);
  }

  const app = createApp({ config, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, model: config.llm.model }, 'Server listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await mongoose.disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
