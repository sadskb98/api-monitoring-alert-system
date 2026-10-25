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
 * - development: pino-pretty to stdout
 * - otherwise:   JSON to stdout (no transport -> synchronous, test-friendly)
 * - LOG_FILE set: additionally append JSON lines to that file (dir auto-created)
 */
export function buildTransportTargets({ level, isDev, file }) {
  const targets = [];
  if (isDev) {
    targets.push({
      target: 'pino-pretty',
      level,
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    });
  } else if (file) {
    targets.push({ target: 'pino/file', level, options: { destination: 1 } });
  }
  if (file) {
    targets.push({ target: 'pino/file', level, options: { destination: file, mkdir: true } });
  }
  return targets;
}

export function createLogger({ level = 'info', isDev = false, file } = {}) {
  const targets = buildTransportTargets({ level, isDev, file });
  const options = { level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } };
  return targets.length ? pino(options, pino.transport({ targets })) : pino(options);
}
