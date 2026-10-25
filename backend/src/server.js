import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectDbOrExit, loadConfigOrExit, warnIfLlmDisabled } from './bootstrap.js';
import { createLogger } from './lib/logger.js';
import { createShutdownHandler } from './lib/shutdown.js';
import { createMonitorService } from './services/monitor.service.js';

dotenv.config({ quiet: true });

async function main() {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.log.level, isDev: config.isDev, file: config.log.file });
  warnIfLlmDisabled(config, logger);
  await connectDbOrExit(config, logger);

  const monitorService = createMonitorService({ config });
  const app = createApp({ config, logger, monitorService });
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.env,
        model: config.llm.model,
        thinking_level: config.llm.thinkingLevel,
        email: config.email.enabled,
      },
      'Server listening',
    );
  });

  const shutdown = createShutdownHandler({
    server,
    closeDb: async () => {
      await monitorService.idle(); // let in-flight digest emails finish (they update notified_at)
      await mongoose.disconnect();
    },
    logger,
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
