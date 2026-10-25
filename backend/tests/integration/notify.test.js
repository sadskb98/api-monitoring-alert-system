import { describe, expect, it } from 'vitest';
import { markNotified } from '../../src/services/alerts/alert.service.js';
import { Alert } from '../../src/models/Alert.js';
import { createAlertWriter } from '../../src/services/llm/alertWriter.js';
import { createMonitorService } from '../../src/services/monitor.service.js';
import { createEmailNotifier } from '../../src/services/notify/email.service.js';
import { useTestDb } from '../db.js';
import { SPEC_EXAMPLE } from '../fixtures.js';
import { captureLogger, testConfig } from '../helpers.js';

useTestDb();

const EMAIL_ENV = { EMAIL_ENABLED: 'true', EMAIL_TO: 'oncall@example.com', EMAIL_MIN_SEVERITY: 'high' };

/** Monitor service with real DB + templates and a recording mail transport. */
function setup({ env = {}, sendMail } = {}) {
  const config = testConfig({ ...EMAIL_ENV, ...env });
  const sent = [];
  const transport = {
    sendMail:
      sendMail ??
      (async (mail) => {
        sent.push(mail);
        return { messageId: `<m${sent.length}@test>` };
      }),
  };
  const service = createMonitorService({
    config,
    alertWriter: createAlertWriter({ llm: config.llm, thresholds: config.thresholds, client: null }),
    notifier: createEmailNotifier({
      email: config.email,
      markNotified,
      createTransport: async () => ({ transport, ethereal: false }),
    }),
  });
  const { log, entries } = captureLogger();
  const post = async (body) => {
    const result = await service.processBatch(body, { source: 'http', log });
    await service.idle();
    return result;
  };
  return { service, post, sent, entries, log };
}

describe('alert digest email (monitor service + MongoDB)', () => {
  it('emails a digest for a new critical alert and sets notified_at', async () => {
    const { post, sent } = setup();
    await post(SPEC_EXAMPLE);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('oncall@example.com');
    expect(sent[0].subject).toMatch(/^\[API Monitor\] CRITICAL AppointmentAPI/);
    expect(sent[0].text).toContain('status 500, returned 0 records and responded in 5500 ms');
    const [alert] = await Alert.find({}).lean();
    expect(alert.notified_at).toBeInstanceOf(Date);
  });

  it('does not email again when the same alert is only touched', async () => {
    const { post, sent } = setup();
    await post(SPEC_EXAMPLE);
    await post(SPEC_EXAMPLE);
    expect(sent).toHaveLength(1);
  });

  it('emails again when the alert escalates', async () => {
    const { post, sent } = setup({ env: { EMAIL_MIN_SEVERITY: 'medium' } });
    await post([{ api_name: 'SearchAPI', response_time_ms: 100, status_code: 200, records_returned: 0 }]);
    await post([{ api_name: 'SearchAPI', response_time_ms: 100, status_code: 503, records_returned: 0 }]);
    expect(sent.map((m) => m.text.match(/\] SearchAPI - (\w+)/)[1])).toEqual(['created', 'escalated']);
  });

  it('skips alerts below EMAIL_MIN_SEVERITY', async () => {
    const { post, sent } = setup();
    await post([{ api_name: 'SearchAPI', response_time_ms: 100, status_code: 200, records_returned: 0 }]);
    expect(sent).toEqual([]);
    const [alert] = await Alert.find({}).lean();
    expect(alert.notified_at).toBeNull();
  });

  it('a failing mail server never fails the batch', async () => {
    const { post, entries } = setup({
      sendMail: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const result = await post(SPEC_EXAMPLE);
    expect(result.alerts.created).toBe(1);
    expect(entries.some((e) => e.msg === 'Failed to send alert digest')).toBe(true);
    const [alert] = await Alert.find({}).lean();
    expect(alert.notified_at).toBeNull();
  });

  it('processBatch resolves before the email is sent (fire-and-forget)', async () => {
    let release;
    const { service, sent, log } = setup({
      sendMail: (mail) =>
        new Promise((resolve) => {
          release = () => {
            sent.push(mail);
            resolve({ messageId: 'x' });
          };
        }),
    });
    await service.processBatch(SPEC_EXAMPLE, { source: 'http', log });
    expect(sent).toEqual([]);
    await new Promise((r) => setTimeout(r, 10)); // let the send reach the transport
    release();
    await service.idle();
    expect(sent).toHaveLength(1);
  });

  it('does not email when EMAIL_ENABLED is false (default)', async () => {
    const { post, sent } = setup({ env: { EMAIL_ENABLED: 'false' } });
    await post(SPEC_EXAMPLE);
    expect(sent).toEqual([]);
  });
});
