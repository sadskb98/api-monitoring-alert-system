import net from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listen } from '../../src/lib/listen.js';
import { captureLogger } from '../helpers.js';

const open = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve()))));
});

/** Hold a free port with a plain TCP server and return its number. */
async function occupyPort() {
  const blocker = net.createServer();
  open.push(blocker);
  await new Promise((resolve) => blocker.listen(0, '::', resolve));
  return blocker.address().port;
}

describe('listen', () => {
  it('logs a clear fatal error and exits 1 when the port is already in use', async () => {
    const port = await occupyPort();
    const { log, entries } = captureLogger();
    const onListening = vi.fn();
    const exited = new Promise((resolve) => {
      listen(express(), { port, logger: log, onListening, exit: resolve });
    });

    expect(await exited).toBe(1);
    expect(onListening).not.toHaveBeenCalled();
    expect(entries).toEqual([
      expect.objectContaining({ level: 60, msg: `Port ${port} is already in use`, port }),
    ]);
  });

  it('calls onListening and serves requests when the port is free', async () => {
    const { log, entries } = captureLogger();
    const exit = vi.fn();
    const server = await new Promise((resolve) => {
      listen(
        express().get('/ping', (_req, res) => res.send('pong')),
        {
          port: 0,
          logger: log,
          onListening: resolve,
          exit,
        },
      );
    });
    open.push(server);

    const res = await fetch(`http://127.0.0.1:${server.address().port}/ping`);
    expect(await res.text()).toBe('pong');
    expect(exit).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it('no longer treats errors after startup as fatal', async () => {
    const { log } = captureLogger();
    const exit = vi.fn();
    const server = await new Promise((resolve) => {
      listen(express(), { port: 0, logger: log, onListening: resolve, exit });
    });
    open.push(server);
    expect(server.listenerCount('error')).toBe(0);
    expect(exit).not.toHaveBeenCalled();
  });
});
