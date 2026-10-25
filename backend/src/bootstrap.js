import mongoose from 'mongoose';
import { ConfigError, parseEnv } from './config/env.js';

/** Validate env or exit(1), printing only the offending keys (never values). */
export function loadConfigOrExit(source = process.env) {
  try {
    return parseEnv(source);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** Connect to MongoDB or exit(1). */
export async function connectDbOrExit(config, logger) {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
    logger.info('Connected to MongoDB');
  } catch (err) {
    logger.fatal({ errName: err.name, errMessage: err.message }, 'Failed to connect to MongoDB');
    process.exit(1);
  }
}

export function warnIfLlmDisabled(config, logger) {
  if (!config.llm.enabled) {
    logger.warn('GEMINI_API_KEY not set: LLM disabled, alerts will use template messages');
  }
}
