import { getHealth } from '../services/health.service.js';

export function createHealthController({ db, llmEnabled, uptime = process.uptime }) {
  return {
    show(_req, res) {
      const { healthy, report } = getHealth({
        dbReadyState: db.readyState,
        llmEnabled,
        uptimeSeconds: uptime(),
      });
      res.status(healthy ? 200 : 503).json(report);
    },
  };
}
