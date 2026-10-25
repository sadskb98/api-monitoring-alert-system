import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUPLICATE_SIGNAL_WINDOW_MS, createShutdownHandler } from '../../src/lib/shutdown.js';
import { silentLogger } from '../helpers.js';

const servers = [];
const sockets = [];

afterEach(() => {
  sockets.splice(0).forEach((s) => s.destroy());
  servers.splice(0).forEach((s) => {
    s.closeAllConnections();
    s.close();
  });
});

async function startServer(handler = (_req, res) => res.end('ok')) {
  const server = http.createServer({ keepAliveTimeout: 60_000 }, handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

/** Raw keep-alive socket; resolves once the given request has been sent (and optionally answered). */
function openSocket(server, { waitForResponse }) {
  return new Promise((resolve) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => {
      socket.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n');
      if (!waitForResponse) setTimeout(() => resolve(socket), 50);
    });
    socket.on('error', () => {});
    if (waitForResponse) socket.once('data', () => resolve(socket));
    sockets.push(socket);
  });
}

function setup(server, opts = {}) {
  const exit = vi.fn();
  const closeDb = opts.closeDb ?? vi.fn().mockResolvedValue();
  const shutdown = createShutdownHandler({
    server,
    closeDb,
    logger: silentLogger,
    timeoutMs: opts.timeoutMs ?? 5000,
    exit,
    now: opts.now,
  });
  return { exit, closeDb, shutdown };
}

describe('createShutdownHandler', () => {
  it('closes the server and DB, then exits 0', async () => {
    const server = await startServer();
    const { exit, closeDb, shutdown } = setup(server);

    await shutdown('SIGINT');

    expect(server.listening).toBe(false);
    expect(closeDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('does not hang on idle keep-alive connections', async () => {
    const server = await startServer();
    await openSocket(server, { waitForResponse: true }); // idle keep-alive socket stays open
    const { exit, shutdown } = setup(server);

    const started = Date.now();
    await shutdown('SIGTERM');

    expect(Date.now() - started).toBeLessThan(1000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('force-exits with 1 after the timeout when a request never finishes', async () => {
    const server = await startServer(() => {}); // never responds
    await openSocket(server, { waitForResponse: false });
    const { exit, shutdown } = setup(server, { timeoutMs: 100 });

    void shutdown('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 1000 });
    expect(exit).not.toHaveBeenCalledWith(0);
  });

  it('exits 1 immediately on a second signal', async () => {
    const server = await startServer(() => {}); // keep shutdown pending
    await openSocket(server, { waitForResponse: false });
    let clock = 1_000;
    const { exit, shutdown } = setup(server, { now: () => clock });

    void shutdown('SIGINT');
    clock += DUPLICATE_SIGNAL_WINDOW_MS + 1;
    await shutdown('SIGINT');

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('ignores a duplicate signal inside the window (node --watch forwards Ctrl+C twice)', async () => {
    const server = await startServer();
    let clock = 1_000;
    const { exit, closeDb, shutdown } = setup(server, { now: () => clock });

    const first = shutdown('SIGINT');
    clock += 2; // watcher's forwarded copy arrives ~1ms later
    await shutdown('SIGINT');
    await first;

    expect(closeDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 if closing the DB fails', async () => {
    const server = await startServer();
    const { exit, shutdown } = setup(server, {
      closeDb: vi.fn().mockRejectedValue(new Error('disconnect failed')),
    });

    await shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('handles a server that is not listening', async () => {
    const server = http.createServer();
    const { exit, closeDb, shutdown } = setup(server);

    await shutdown('SIGTERM');

    expect(closeDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
