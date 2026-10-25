import nodemailer from 'nodemailer';
import { buildDigest, selectForDigest } from './digest.js';

// nodemailer defaults are minutes; a stuck SMTP server should not hold a send (or shutdown) that long.
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

/**
 * Default transport: the configured SMTP server, or (no SMTP_HOST, dev only) an Ethereal
 * test account whose messages can be viewed at the preview URL that gets logged.
 * @returns {Promise<{ transport, ethereal: boolean }>}
 */
export async function createDefaultTransport(smtp) {
  if (smtp) {
    const auth = smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined;
    const options = { host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth, ...SMTP_TIMEOUTS };
    return { transport: nodemailer.createTransport(options), ethereal: false };
  }
  const account = await nodemailer.createTestAccount();
  const options = {
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
    ...SMTP_TIMEOUTS,
  };
  return { transport: nodemailer.createTransport(options), ethereal: true };
}

/**
 * Emails one digest per batch (created/escalated alerts at or above EMAIL_MIN_SEVERITY).
 * Fire-and-forget: notifyBatch never rejects and never affects ingestion. Failures are logged.
 * idle() resolves once in-flight sends finish (used by the CLI and graceful shutdown).
 *
 * @param {object}   deps
 * @param {object}   deps.email          config.email
 * @param {Function} deps.markNotified   (alertIds, at) => Promise; sets notified_at
 * @param {Function} [deps.createTransport] () => Promise<{ transport, ethereal }>; created once, lazily
 */
export function createEmailNotifier({
  email,
  markNotified,
  createTransport = () => createDefaultTransport(email.smtp),
  previewUrl = nodemailer.getTestMessageUrl,
  now = () => new Date(),
}) {
  const pending = new Set();
  let transportPromise = null;

  // Created on first send; a failed setup (e.g. Ethereal unreachable) is retried on the next batch.
  function getTransport() {
    transportPromise ??= createTransport().catch((err) => {
      transportPromise = null;
      throw err;
    });
    return transportPromise;
  }

  async function send(response, { source, log }) {
    const items = selectForDigest(response.items, email.minSeverity);
    if (items.length === 0) return { sent: false, alerts: 0 };
    const context = { batch_id: response.batch_id, alerts: items.length };

    let info;
    let ethereal;
    try {
      const created = await getTransport();
      ethereal = created.ethereal;
      const digest = buildDigest(items, {
        batch_id: response.batch_id,
        source,
        min_severity: email.minSeverity,
      });
      info = await created.transport.sendMail({ from: email.from, to: email.to, ...digest });
    } catch (err) {
      // message/code only: transport errors can echo connection details
      log.error(
        { ...context, errName: err.name, errMessage: err.message, code: err.code },
        'Failed to send alert digest',
      );
      return { sent: false, alerts: items.length };
    }

    const preview_url = ethereal ? previewUrl(info) || null : null;
    log.info({ ...context, message_id: info.messageId, preview_url }, 'Alert digest emailed');
    try {
      await markNotified(
        items.map((i) => i.alert_id),
        now(),
      );
    } catch (err) {
      log.warn({ ...context, errMessage: err.message }, 'Alert digest sent but notified_at was not updated');
    }
    return { sent: true, alerts: items.length, preview_url };
  }

  function notifyBatch(response, ctx) {
    if (!email.enabled) return Promise.resolve({ sent: false, alerts: 0 });
    const promise = send(response, ctx).finally(() => pending.delete(promise));
    pending.add(promise);
    return promise;
  }

  async function idle() {
    await Promise.allSettled([...pending]);
  }

  return { notifyBatch, idle };
}
