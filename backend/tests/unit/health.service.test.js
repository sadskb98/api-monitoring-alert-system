import { describe, expect, it } from 'vitest';
import { getHealth } from '../../src/services/health.service.js';

describe('getHealth', () => {
  it('is healthy when the DB is connected', () => {
    expect(getHealth({ dbReadyState: 1, llmEnabled: true, uptimeSeconds: 12.7 })).toEqual({
      healthy: true,
      report: { status: 'ok', db: 'up', llm: 'enabled', uptime_s: 12 },
    });
  });

  it('is degraded when the DB is not connected', () => {
    const { healthy, report } = getHealth({ dbReadyState: 0, llmEnabled: false, uptimeSeconds: 1 });
    expect(healthy).toBe(false);
    expect(report).toMatchObject({ status: 'degraded', db: 'down', llm: 'disabled' });
  });
});
