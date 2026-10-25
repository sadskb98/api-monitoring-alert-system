import pino from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'apiKey',
  '*.apiKey',
  '*.*.apiKey',
  'pass',
  '*.pass',
  '*.*.pass',
  'GEMINI_API_KEY',
  'SMTP_PASS',
  'mongoUri',
  '*.mongoUri',
];

/**
 * Pure: decide pino transport targets.
 * - development: pino-pretty to the console stream
 * - otherwise:   JSON to the console stream (no transport -> synchronous, test-friendly)
 * - LOG_FILE set: additionally append JSON lines to that file (dir auto-created)
 * The console stream is stdout (1) by default; the CLI uses stderr (2) to keep stdout for its result.
 */
export function buildTransportTargets({ level, isDev, file, destination = 1 }) {
  const targets = [];
  if (isDev) {
    targets.push({
      target: 'pino-pretty',
      level,
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname', destination },
    });
  } else if (file) {
    targets.push({ target: 'pino/file', level, options: { destination } });
  }
  if (file) {
    targets.push({ target: 'pino/file', level, options: { destination: file, mkdir: true } });
  }
  return targets;
}

export function createLogger({ level = 'info', isDev = false, file, destination = 1 } = {}) {
  const targets = buildTransportTargets({ level, isDev, file, destination });
  const options = { level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } };
  if (targets.length) return pino(options, pino.transport({ targets }));
  return destination === 1 ? pino(options) : pino(options, pino.destination(destination));
}
