export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
// `node --watch` forwards the terminal's SIGINT to the child, which also receives it
// directly from the process group: one Ctrl+C arrives twice ~1ms apart. Repeats inside
// this window are treated as the same keypress; a real second Ctrl+C is much slower.
export const DUPLICATE_SIGNAL_WINDOW_MS = 250;

/** Promisified server.close() that also drops idle keep-alive sockets so close can finish. */
function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections?.();
  });
}

/**
 * Build a signal handler for graceful shutdown.
 * - 1st signal: stop accepting connections, close the HTTP server and DB, then exit(0).
 *   If that takes longer than timeoutMs, drop all sockets and exit(1).
 * - 2nd signal (after DUPLICATE_SIGNAL_WINDOW_MS): exit(1) immediately.
 */
export function createShutdownHandler({
  server,
  closeDb,
  logger,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  exit = (code) => process.exit(code),
  now = Date.now,
}) {
  let shuttingDown = false;
  let firstSignalAt = 0;
  let exited = false;
  let timer;

  // Exit exactly once, whichever path (graceful, timeout, second signal) gets there first.
  const finish = (code) => {
    if (exited) return;
    exited = true;
    clearTimeout(timer);
    exit(code);
  };

  return async function shutdown(signal) {
    if (shuttingDown) {
      if (now() - firstSignalAt < DUPLICATE_SIGNAL_WINDOW_MS) {
        logger.debug({ signal }, 'Ignoring duplicate signal');
        return;
      }
      logger.warn({ signal }, 'Second signal received, forcing exit');
      return finish(1);
    }
    shuttingDown = true;
    firstSignalAt = now();
    logger.info({ signal, timeoutMs }, 'Shutting down gracefully');

    timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'Graceful shutdown timed out, forcing exit');
      finish(1);
      server.closeAllConnections?.();
    }, timeoutMs);
    timer.unref();

    try {
      await closeServer(server);
      await closeDb();
      if (!exited) logger.info('Shutdown complete');
      finish(0);
    } catch (err) {
      logger.error({ errName: err.name, errMessage: err.message }, 'Error during shutdown');
      finish(1);
    }
  };
}
