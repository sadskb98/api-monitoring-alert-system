import mongoose from 'mongoose';
import { ValidationError } from '../lib/errors.js';
import { Batch } from '../models/Batch.js';
import { parseBatch } from '../schemas/observation.schema.js';
import { applyPlan, findActiveByFingerprints, markNotified } from './alerts/alert.service.js';
import { messageRequests, planBatch } from './alerts/dedup.js';
import { detect } from './detection/detector.js';
import { createAlertWriter } from './llm/alertWriter.js';
import { createEmailNotifier } from './notify/email.service.js';

/** applyPlan result groups reported to the client (healthy-streak bumps are not). */
const ACTIONS = ['created', 'escalated', 'updated', 'resolved'];

/** Pure: response item for one alert touched by the batch. */
function toItem(alert, action) {
  return {
    alert_id: alert.id,
    api_name: alert.api_name,
    action,
    status: alert.status,
    severity: alert.severity,
    anomalies: alert.anomalies,
    title: alert.title,
    message: alert.message,
    suggested_action: alert.suggested_action,
    message_source: alert.message_source,
    message_model: alert.message_model,
  };
}

/** Pure: POST /monitor response body. */
export function buildBatchResponse({ batchId, received, accepted, rejected, findings, result, llm }) {
  return {
    batch_id: String(batchId),
    received,
    accepted,
    rejected,
    findings,
    alerts: Object.fromEntries(ACTIONS.map((action) => [action, result[action].length])),
    llm: { status: llm.status, model: llm.model, attempts: llm.attempts, latency_ms: llm.latency_ms },
    items: ACTIONS.flatMap((action) => result[action].map((alert) => toItem(alert, action))),
  };
}

/**
 * Orchestrates one batch end to end (HTTP and CLI file ingest):
 * validate -> detect -> load active alerts -> plan -> write text (one LLM call) -> persist -> audit,
 * then emails a digest in the background (never delays or fails the batch).
 * idle() waits for in-flight emails, so short-lived callers (CLI, shutdown) don't cut them off.
 */
export function createMonitorService({
  config,
  alertWriter = createAlertWriter({ llm: config.llm, thresholds: config.thresholds }),
  notifier = createEmailNotifier({ email: config.email, markNotified }),
}) {
  async function processBatch(body, { source, requestId = null, log, now = new Date() }) {
    const { received, accepted, rejected } = parseBatch(body, {
      maxBatchSize: config.maxBatchSize,
      receivedAt: now,
    });
    if (accepted.length === 0) throw new ValidationError('No valid observations in batch', rejected);

    const { findings, healthy } = detect(accepted, config.thresholds);
    const fingerprints = [...new Set(accepted.map((o) => o.fingerprint))];
    const plan = planBatch({
      findings,
      healthy,
      activeAlerts: await findActiveByFingerprints(fingerprints),
      resolveAfterHealthy: config.alerts.resolveAfterHealthy,
    });

    const { messages, llm } = await alertWriter.writeMessages(messageRequests(plan), { log });
    const batchId = new mongoose.Types.ObjectId();
    const result = await applyPlan(plan, { messages, batchId, now });

    const response = buildBatchResponse({
      batchId,
      received,
      accepted: accepted.length,
      rejected,
      findings: findings.length,
      result,
      llm,
    });
    await recordBatch({ batchId, source, requestId, response, log });
    log.info(
      { batch_id: response.batch_id, received, alerts: response.alerts, llm: response.llm },
      'Batch processed',
    );
    void notifier.notifyBatch(response, { source, log }); // fire-and-forget; never rejects
    return response;
  }

  return { processBatch, idle: notifier.idle };
}

/** Audit write is best-effort: alerts are already persisted, so a failure here must not fail the batch. */
async function recordBatch({ batchId, source, requestId, response, log }) {
  try {
    await Batch.create({
      _id: batchId,
      source,
      request_id: requestId,
      received: response.received,
      accepted: response.accepted,
      rejected: response.rejected.length,
      findings: response.findings,
      alerts: response.alerts,
      llm: response.llm,
    });
  } catch (err) {
    log.error({ err, batch_id: String(batchId) }, 'Failed to record batch audit');
  }
}
