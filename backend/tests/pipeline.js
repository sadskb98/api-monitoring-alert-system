import { parseBatch } from '../src/schemas/observation.schema.js';
import { applyPlan, findActiveByFingerprints } from '../src/services/alerts/alert.service.js';
import { needsMessage, planBatch } from '../src/services/alerts/dedup.js';
import { detect } from '../src/services/detection/detector.js';
import { THRESHOLDS } from './fixtures.js';

/** Stub alert text (the LLM/template writer arrives in phase 4). */
export function stubMessages(findings, tag = 'v1') {
  return new Map(
    findings.map((f) => [
      f.fingerprint,
      {
        title: `${f.api_name} ${f.severity} (${tag})`,
        message: `${f.api_name}: ${f.anomalies.map((a) => a.rule).join(', ')} (${tag})`,
        suggested_action: 'Investigate.',
        message_source: 'template',
      },
    ]),
  );
}

/** parse -> detect -> load active -> plan -> apply, as monitor.service will do in phase 4. */
export async function runBatch(records, { now = new Date(), resolveAfterHealthy = 1, tag } = {}) {
  const { accepted } = parseBatch(records, { maxBatchSize: 1000, receivedAt: now });
  const { findings, healthy } = detect(accepted, THRESHOLDS);
  const activeAlerts = await findActiveByFingerprints([...findings, ...healthy].map((x) => x.fingerprint));
  const plan = planBatch({ findings, healthy, activeAlerts, resolveAfterHealthy });
  const result = await applyPlan(plan, { messages: stubMessages(needsMessage(plan), tag), now });
  return { plan, result };
}
