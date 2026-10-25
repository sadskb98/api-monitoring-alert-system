import { compareSeverity, maxSeverity } from '../../lib/severity.js';
import { RULES } from '../detection/rules.js';

/**
 * Pure: is `rule` new for this alert?
 * A rule counts as new if it was never seen since the alert opened, unless it is a
 * same-category downgrade (e.g. LATENCY_WARNING after LATENCY_CRITICAL was seen):
 * an improvement should not trigger a regenerated message.
 */
export function isNewRule(rule, seenRules) {
  if (seenRules.includes(rule)) return false;
  const { category, severity } = RULES[rule];
  return !seenRules.some((seen) => {
    const def = RULES[seen];
    return def && def.category === category && compareSeverity(def.severity, severity) >= 0;
  });
}

/** Pure: why (if at all) a finding escalates an active alert. */
export function escalationReasons(alert, finding) {
  const reasons = [];
  if (compareSeverity(finding.severity, alert.severity) > 0) reasons.push('severity_increased');
  const newRules = finding.anomalies.map((a) => a.rule).filter((rule) => isNewRule(rule, alert.seen_rules));
  if (newRules.length > 0) reasons.push('new_rules');
  return { reasons, newRules };
}

/**
 * Pure: decide what happens to each API in a batch.
 *
 *   finding, no active alert                         -> create
 *   finding, active alert, severity up or new rule   -> escalate (message regenerated)
 *   finding, active alert, otherwise                 -> touch    (message kept)
 *   healthy, active alert, streak < threshold        -> healthy  (streak advanced)
 *   healthy, active alert, streak >= threshold       -> resolve  (auto)
 *   healthy, no active alert / API absent from batch -> nothing
 *
 * @param {object}   args
 * @param {object[]} args.findings      detector findings
 * @param {object[]} args.healthy       detector healthy entries
 * @param {object[]} args.activeAlerts  active alerts for the batch's fingerprints
 * @param {number}   args.resolveAfterHealthy
 */
export function planBatch({ findings, healthy, activeAlerts, resolveAfterHealthy }) {
  const activeByFingerprint = new Map(activeAlerts.map((a) => [a.fingerprint, a]));
  const plan = { create: [], escalate: [], touch: [], healthy: [], resolve: [] };

  for (const finding of findings) {
    const alert = activeByFingerprint.get(finding.fingerprint);
    if (!alert) {
      plan.create.push({ finding });
      continue;
    }
    const { reasons, newRules } = escalationReasons(alert, finding);
    if (reasons.length > 0) plan.escalate.push({ alert, finding, reasons, newRules });
    else plan.touch.push({ alert, finding });
  }

  for (const entry of healthy) {
    const alert = activeByFingerprint.get(entry.fingerprint);
    if (!alert) continue;
    const streak = alert.healthy_streak + entry.healthy_records;
    const target = streak >= resolveAfterHealthy ? plan.resolve : plan.healthy;
    target.push({ alert, entry, streak });
  }

  return plan;
}

/** Pure: fingerprints that need fresh alert text (one LLM call covers all of them). */
export function needsMessage(plan) {
  return [...plan.create.map((c) => c.finding), ...plan.escalate.map((e) => e.finding)];
}

/** Pure: peak severity after applying a finding. */
export function nextPeakSeverity(alert, finding) {
  return maxSeverity([alert.peak_severity, finding.severity]);
}

/** Pure: seen_rules after applying a finding (union, stable order). */
export function nextSeenRules(alert, finding) {
  return [...new Set([...alert.seen_rules, ...finding.anomalies.map((a) => a.rule)])];
}
