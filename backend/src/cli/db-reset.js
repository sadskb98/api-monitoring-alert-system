import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDbOrExit, loadConfigOrExit } from '../bootstrap.js';
import { createLogger } from '../lib/logger.js';
import { Alert } from '../models/Alert.js';
import { Batch } from '../models/Batch.js';

/**
 * Delete every alert and batch (e.g. before recording a demo).
 *
 *   npm run db:reset            # asks for confirmation
 *   npm run db:reset -- --yes   # no prompt
 *
 * Refuses to run when NODE_ENV=production. Indexes are kept (deleteMany, not drop).
 * Exit codes: 0 deleted, 1 refused/aborted/failed, 2 usage error.
 */

export const USAGE = 'Usage: npm run db:reset [-- --yes]';

/** Pure: argv (after the script) -> { yes } | { usage: true }. */
export function parseArgs(args) {
  const yes = args.some((a) => a === '--yes' || a === '-y');
  const unknown = args.filter((a) => a !== '--yes' && a !== '-y');
  return unknown.length ? { usage: true } : { yes };
}

export const refuseProduction = (env) => env === 'production';

/** Pure: "yes"/"y" (any case) confirms; anything else aborts. */
export const isConfirmation = (answer) => ['yes', 'y'].includes(String(answer).trim().toLowerCase());

/**
 * Run the reset against the current mongoose connection; returns the exit code.
 * @param {object}   options
 * @param {string}   options.env       config.env
 * @param {boolean}  options.yes       skip the prompt
 * @param {Function} options.confirm   (question) => Promise<boolean>
 */
export async function runReset({
  env,
  yes,
  confirm,
  db = mongoose.connection,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (refuseProduction(env)) {
    stderr.write('Refusing to reset: NODE_ENV=production.\n');
    return 1;
  }

  const [alerts, batches] = await Promise.all([Alert.countDocuments(), Batch.countDocuments()]);
  const target = `database "${db.name}" on ${db.host}`;
  if (!yes) {
    const question = `Delete ${alerts} alert(s) and ${batches} batch(es) from ${target}? Type "yes" to confirm: `;
    if (!(await confirm(question))) {
      stdout.write('Aborted; nothing was deleted.\n');
      return 1;
    }
  }

  const [alertResult, batchResult] = await Promise.all([Alert.deleteMany({}), Batch.deleteMany({})]);
  stdout.write(
    `Deleted ${alertResult.deletedCount} alert(s) and ${batchResult.deletedCount} batch(es) from ${target}.\n`,
  );
  return 0;
}

/** Interactive yes/no on the terminal; without a TTY there is no one to ask, so it declines. */
async function askOnTerminal(question) {
  if (!process.stdin.isTTY) {
    process.stderr.write('No terminal to confirm on; pass --yes to reset without a prompt.\n');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isConfirmation(await rl.question(question));
  } finally {
    rl.close();
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
  // Checked before connecting, so a production database is never even opened.
  if (refuseProduction(config.env)) {
    console.error('Refusing to reset: NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.log.level, isDev: config.isDev, destination: 2 });
  await connectDbOrExit(config, logger);
  try {
    process.exitCode = await runReset({ env: config.env, yes: args.yes, confirm: askOnTerminal });
  } catch (err) {
    console.error(`Reset failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
