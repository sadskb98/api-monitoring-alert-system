import { randomUUID } from 'node:crypto';
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDbOrExit, loadConfigOrExit, warnIfLlmDisabled } from '../bootstrap.js';
import { AppError, toErrorBody } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { createMonitorService } from '../services/monitor.service.js';

/**
 * Ingest a static JSON file through the same pipeline as POST /monitor.
 *
 *   npm run ingest -- fixtures/sample-batch.json
 *
 * stdout: the batch result as JSON (same shape as the HTTP response); logs go to stderr.
 * Exit codes: 0 processed, 1 unreadable/invalid file or processing error, 2 usage error.
 */

export const USAGE = 'Usage: npm run ingest -- <path/to/batch.json>';

/** Pure: argv (after the script) -> { file } | { usage: true }. */
export function parseArgs(args) {
  if (args.length !== 1 || ['-h', '--help'].includes(args[0])) return { usage: true };
  return { file: args[0] };
}

/**
 * Run one ingest with injected dependencies; returns the exit code.
 * Waits for the digest email (if any) before returning so the process can exit cleanly.
 */
export async function runIngest(
  file,
  { monitorService, logger, readFile = fsReadFile, stdout = process.stdout, stderr = process.stderr },
) {
  const absolute = path.resolve(file);
  let body;
  try {
    body = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'file not found' : err.message;
    stderr.write(`Cannot read ${file}: ${reason}\n`);
    return 1;
  }

  const requestId = `file-${randomUUID()}`;
  const log = logger.child({ reqId: requestId, file: absolute });
  try {
    const result = await monitorService.processBatch(body, { source: 'file', requestId, log });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof AppError) {
      stderr.write(`${JSON.stringify(toErrorBody(err), null, 2)}\n`);
    } else {
      log.error({ err }, 'Ingest failed');
    }
    return 1;
  } finally {
    await monitorService.idle();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.usage) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  dotenv.config({ quiet: true });
  const config = loadConfigOrExit();
  const logger = createLogger({
    level: config.log.level,
    isDev: config.isDev,
    file: config.log.file,
    destination: 2, // stdout carries the result
  });
  warnIfLlmDisabled(config, logger);
  await connectDbOrExit(config, logger);

  const monitorService = createMonitorService({ config });
  try {
    process.exitCode = await runIngest(args.file, { monitorService, logger });
  } finally {
    await mongoose.disconnect();
  }
}

// Run only when executed directly (tests import runIngest/parseArgs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
