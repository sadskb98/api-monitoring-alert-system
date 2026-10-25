import { describe, expect, it } from 'vitest';
import { createEmailNotifier } from '../../../src/services/notify/email.service.js';
import { captureLogger } from '../../helpers.js';

const EMAIL = {
  enabled: true,
  minSeverity: 'high',
  from: 'API Monitor <alerts@api-monitor.local>',
  to: 'oncall@example.com',
  smtp: null,
};
const AT = new Date('2026-10-26T10:00:00Z');

const item = (overrides = {}) => ({
  alert_id: 'a1',
  api_name: 'AppointmentAPI',
  action: 'created',
  status: 'active',
  severity: 'critical',
  anomalies: [{ rule: 'HTTP_5XX', category: 'AVAILABILITY', severity: 'critical' }],
  title: 'AppointmentAPI: server errors',
  message: 'AppointmentAPI failed with status 500.',
  suggested_action: 'Check service logs.',
  message_source: 'template',
  message_model: null,
  ...overrides,
});
const response = (items) => ({ batch_id: 'b1', items });

function setup({ email = {}, sendMail, createTransport, markNotified } = {}) {
  const sent = [];
  const notified = [];
  let transportsCreated = 0;
  const transport = {
    sendMail:
      sendMail ??
      (async (mail) => {
        sent.push(mail);
        return { messageId: '<m1@test>', response: '250 Accepted' };
      }),
  };
  const notifier = createEmailNotifier({
    email: { ...EMAIL, ...email },
    markNotified: markNotified ?? (async (ids, at) => notified.push({ ids, at })),
    createTransport:
      createTransport ??
      (async () => {
        transportsCreated++;
        return { transport, ethereal: true };
      }),
    previewUrl: () => 'https://ethereal.email/message/abc',
    now: () => AT,
  });
  const capture = captureLogger();
  const notify = (items) => notifier.notifyBatch(response(items), { source: 'http', log: capture.log });
  return { notifier, notify, sent, notified, transports: () => transportsCreated, ...capture };
}

describe('createEmailNotifier', () => {
  it('sends one digest for qualifying alerts, logs the Ethereal preview URL and marks them notified', async () => {
    const { notify, sent, notified, entries } = setup();
    const result = await notify([item(), item({ alert_id: 'a2', api_name: 'B', severity: 'medium' })]);

    expect(result).toEqual({ sent: true, alerts: 1, preview_url: 'https://ethereal.email/message/abc' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: EMAIL.from,
      to: 'oncall@example.com',
      subject: '[API Monitor] CRITICAL AppointmentAPI: server errors',
    });
    expect(sent[0].text).toContain('AppointmentAPI failed with status 500.');
    expect(sent[0].html).toContain('AppointmentAPI failed with status 500.');
    expect(notified).toEqual([{ ids: ['a1'], at: AT }]);
    expect(entries.find((e) => e.msg === 'Alert digest emailed')).toMatchObject({
      level: 30,
      batch_id: 'b1',
      alerts: 1,
      message_id: '<m1@test>',
      preview_url: 'https://ethereal.email/message/abc',
    });
  });

  it('sends nothing when no alert qualifies', async () => {
    const { notify, sent } = setup();
    expect(await notify([item({ severity: 'medium' }), item({ action: 'updated' })])).toEqual({
      sent: false,
      alerts: 0,
    });
    expect(sent).toEqual([]);
  });

  it('does nothing when email is disabled', async () => {
    const { notify, sent, transports } = setup({ email: { enabled: false } });
    expect(await notify([item()])).toEqual({ sent: false, alerts: 0 });
    expect(sent).toEqual([]);
    expect(transports()).toBe(0);
  });

  it('creates the transport once and reuses it', async () => {
    const { notify, transports } = setup();
    await notify([item()]);
    await notify([item()]);
    expect(transports()).toBe(1);
  });

  it('logs a send failure, does not throw, and does not mark alerts notified', async () => {
    const err = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
    const { notify, notified, entries } = setup({
      sendMail: async () => {
        throw err;
      },
    });
    expect(await notify([item()])).toEqual({ sent: false, alerts: 1 });
    expect(notified).toEqual([]);
    expect(entries.find((e) => e.msg === 'Failed to send alert digest')).toMatchObject({
      level: 50,
      errMessage: 'Connection timeout',
      code: 'ETIMEDOUT',
    });
  });

  it('retries transport setup on the next batch after it fails (e.g. Ethereal unreachable)', async () => {
    let attempts = 0;
    const { notify, sent } = setup({
      createTransport: async () => {
        attempts++;
        if (attempts === 1) throw new Error('getaddrinfo ENOTFOUND api.nodemailer.com');
        return {
          ethereal: false,
          transport: {
            sendMail: async (mail) => {
              sent.push(mail);
              return { messageId: '<m2@test>' };
            },
          },
        };
      },
    });
    expect((await notify([item()])).sent).toBe(false);
    expect((await notify([item()])).sent).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('omits the preview URL for a real SMTP transport', async () => {
    const { notify } = setup({
      createTransport: async () => ({
        ethereal: false,
        transport: { sendMail: async () => ({ messageId: 'x' }) },
      }),
    });
    expect((await notify([item()])).preview_url).toBeNull();
  });

  it('warns but still reports success when notified_at cannot be updated', async () => {
    const { notify, warnings } = setup({
      markNotified: async () => {
        throw new Error('db down');
      },
    });
    expect((await notify([item()])).sent).toBe(true);
    expect(warnings('Alert digest sent but notified_at was not updated')).toEqual([
      expect.objectContaining({ errMessage: 'db down' }),
    ]);
  });

  it('idle() waits for in-flight sends', async () => {
    let release;
    const { notifier, sent } = setup({
      sendMail: (mail) =>
        new Promise((resolve) => {
          release = () => {
            sent.push(mail);
            resolve({ messageId: 'x' });
          };
        }),
    });
    const { log } = captureLogger();
    notifier.notifyBatch(response([item()]), { source: 'file', log });

    let idle = false;
    const waiting = notifier.idle().then(() => (idle = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(idle).toBe(false);
    release();
    await waiting;
    expect(sent).toHaveLength(1);
  });
});
