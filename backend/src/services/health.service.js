// Mongoose readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
const DB_STATES = { 0: 'down', 1: 'up', 2: 'connecting', 3: 'disconnecting' };

/** Pure: build a health report from the DB connection state. */
export function getHealth({ dbReadyState, llmEnabled, uptimeSeconds }) {
  const db = DB_STATES[dbReadyState] ?? 'unknown';
  return {
    healthy: db === 'up',
    report: {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      llm: llmEnabled ? 'enabled' : 'disabled',
      uptime_s: Math.floor(uptimeSeconds),
    },
  };
}
