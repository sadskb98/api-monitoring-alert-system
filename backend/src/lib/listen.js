import http from 'node:http';

/**
 * Start the HTTP server, failing loudly if it can't bind.
 * Express 5's app.listen(port, cb) hands a listen error to the callback, which used to log
 * "Server listening" and leave the process running without serving anything.
 * Startup errors (EADDRINUSE, EACCES, ...) are logged as fatal and exit(1).
 *
 * @returns {http.Server}
 */
export function listen(app, { port, logger, onListening = () => {}, exit = (code) => process.exit(code) }) {
  const server = http.createServer(app);

  const onStartupError = (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.fatal({ port }, `Port ${port} is already in use`);
    } else {
      logger.fatal(
        { port, errName: err.name, errMessage: err.message, code: err.code },
        'Server failed to start',
      );
    }
    exit(1);
  };

  server.once('error', onStartupError);
  server.listen(port, () => {
    server.off('error', onStartupError); // only startup errors are fatal here
    onListening(server);
  });
  return server;
}
