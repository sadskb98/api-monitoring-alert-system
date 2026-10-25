import { describe, expect, it } from 'vitest';
import { buildTransportTargets } from '../../src/lib/logger.js';

describe('buildTransportTargets', () => {
  it('uses no transport outside development without a log file (plain JSON stdout)', () => {
    expect(buildTransportTargets({ level: 'info', isDev: false })).toEqual([]);
  });

  it('uses pino-pretty in development', () => {
    const targets = buildTransportTargets({ level: 'debug', isDev: true });
    expect(targets.map((t) => t.target)).toEqual(['pino-pretty']);
    expect(targets[0].level).toBe('debug');
  });

  it('adds a file target with mkdir when LOG_FILE is set', () => {
    const targets = buildTransportTargets({ level: 'info', isDev: true, file: 'logs/app.log' });
    expect(targets.map((t) => t.target)).toEqual(['pino-pretty', 'pino/file']);
    expect(targets[1].options).toEqual({ destination: 'logs/app.log', mkdir: true });
  });

  it('can send console output to stderr (CLI) instead of stdout', () => {
    expect(buildTransportTargets({ level: 'info', isDev: true, destination: 2 })[0].options.destination).toBe(
      2,
    );
    const targets = buildTransportTargets({ level: 'info', isDev: false, file: 'x.log', destination: 2 });
    expect(targets.map((t) => t.options.destination)).toEqual([2, 'x.log']);
  });

  it('keeps JSON stdout alongside the file outside development', () => {
    const targets = buildTransportTargets({ level: 'info', isDev: false, file: 'logs/app.log' });
    expect(targets.map((t) => t.options.destination)).toEqual([1, 'logs/app.log']);
  });
});
