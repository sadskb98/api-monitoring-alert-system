import { NotFoundError } from '../../lib/errors.js';
import { SEVERITIES, severityRank } from '../../lib/severity.js';
import { Alert } from '../../models/Alert.js';
import { escalationReasons, nextPeakSeverity, nextSeenRules } from './dedup.js';
import { fingerprintFor } from './fingerprint.js';

const DUPLICATE_KEY = 11000;

const minNullable = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));
const maxNullable = (a, b) => (a === null ? b : b === null ? a : Math.max(a, b));

function messageFields(message, now) {
  return {
    title: message.title,
    message: message.message,
    suggested_action: message.suggested_action ?? null,
    message_source: message.message_source,
    message_model: message.message_model ?? null,
    message_generated_at: now,
  };
}

/** Pure: full document for a new active alert. */
export function buildCreateDoc(finding, message, { batchId, now }) {
  const { batch_stats: stats } = finding;
  return {
    fingerprint: finding.fingerprint,
    api_name: finding.api_name,
    anomalies: finding.anomalies,
    seen_rules: finding.anomalies.map((a) => a.rule),
    severity: finding.severity,
    severity_rank: severityRank(finding.severity),
    peak_severity: finding.severity,
    status: 'active',
    ...messageFields(message, now),
    last_observation: finding.worst_observation,
    stats: {
      occurrences: stats.anomalous_records,
      max_response_time_ms: stats.max_response_time_ms,
      min_records_returned: stats.min_records_returned,
    },
    healthy_streak: 0,
    first_seen_at: stats.first_observed_at,
    last_seen_at: stats.last_observed_at,
    resolved_at: null,
    resolved_by: null,
    last_batch_id: batchId,
  };
}

/**
 * Pure: update for an active alert that saw the finding again.
 * With `message` it is an escalation (text regenerated); without, a touch (text kept).
 * Severity follows the current finding (it may go down); peak_severity never decreases.
 */
export function buildFindingUpdate(alert, finding, { batchId, message = null, now }) {
  const { batch_stats: stats } = finding;
  return {
    $set: {
      anomalies: finding.anomalies,
      seen_rules: nextSeenRules(alert, finding),
      severity: finding.severity,
      severity_rank: severityRank(finding.severity),
      peak_severity: nextPeakSeverity(alert, finding),
      last_observation: finding.worst_observation,
      'stats.max_response_time_ms': maxNullable(alert.stats.max_response_time_ms, stats.max_response_time_ms),
      'stats.min_records_returned': minNullable(alert.stats.min_records_returned, stats.min_records_returned),
      healthy_streak: 0,
      last_batch_id: batchId,
      ...(message ? messageFields(message, now) : {}),
    },
    $inc: { 'stats.occurrences': stats.anomalous_records },
    $max: { last_seen_at: stats.last_observed_at },
  };
}

function updateActive(id, update) {
  return { updateOne: { filter: { _id: id, status: 'active' }, update } };
}

function requireMessage(messages, fingerprint) {
  const message = messages.get(fingerprint);
  if (!message) throw new Error(`No alert message provided for ${fingerprint}`);
  return message;
}

/** Writes errors other than duplicate-key races are real failures. */
function splitBulkError(err) {
  const writeErrors = [].concat(err?.writeErrors ?? []);
  if (!err?.result || writeErrors.length === 0 || writeErrors.some((e) => e.code !== DUPLICATE_KEY)) {
    throw err;
  }
  return { result: err.result, duplicateIndexes: new Set(writeErrors.map((e) => e.index)) };
}

async function bulkWrite(ops) {
  if (ops.length === 0) return { result: { upsertedIds: {} }, duplicateIndexes: new Set() };
  try {
    return { result: await Alert.bulkWrite(ops, { ordered: false }), duplicateIndexes: new Set() };
  } catch (err) {
    return splitBulkError(err);
  }
}

/** Record that a notification covering these alerts was sent. */
export async function markNotified(ids, at) {
  if (ids.length === 0) return;
  await Alert.updateMany({ _id: { $in: ids } }, { $set: { notified_at: at } });
}

export async function findActiveByFingerprints(fingerprints) {
  if (fingerprints.length === 0) return [];
  return Alert.find({ status: 'active', fingerprint: { $in: fingerprints } }).lean();
}

/**
 * Apply a dedup plan in one bulkWrite (plus one retry round for create races).
 *
 * Creates are upserts keyed on { fingerprint, status: 'active' } with $setOnInsert, backed by
 * the partial unique index. If a concurrent batch created the alert first (matched instead of
 * upserted, or E11000), the finding is re-applied to that alert as an escalate/touch.
 *
 * @param {object} plan     from planBatch()
 * @param {object} options
 * @param {Map<string, object>} options.messages  fingerprint -> { title, message, suggested_action, message_source }
 *                                                 (required for every create/escalate)
 * @returns {Promise<{created, escalated, updated, resolved, healthy}>} arrays of alert JSON
 */
export async function applyPlan(plan, { messages, batchId = null, now = new Date() }) {
  const ops = [];
  const ids = { escalated: [], updated: [], resolved: [], healthy: [] };

  plan.create.forEach(({ finding }) => {
    const doc = buildCreateDoc(finding, requireMessage(messages, finding.fingerprint), { batchId, now });
    ops.push({
      updateOne: {
        filter: { fingerprint: finding.fingerprint, status: 'active' },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    });
  });
  for (const { alert, finding } of plan.escalate) {
    const message = requireMessage(messages, finding.fingerprint);
    ops.push(updateActive(alert._id, buildFindingUpdate(alert, finding, { batchId, message, now })));
    ids.escalated.push(alert._id);
  }
  for (const { alert, finding } of plan.touch) {
    ops.push(updateActive(alert._id, buildFindingUpdate(alert, finding, { batchId, now })));
    ids.updated.push(alert._id);
  }
  for (const { alert, streak } of plan.healthy) {
    ops.push(updateActive(alert._id, { $set: { healthy_streak: streak } }));
    ids.healthy.push(alert._id);
  }
  for (const { alert, streak } of plan.resolve) {
    ops.push(
      updateActive(alert._id, {
        $set: { status: 'resolved', resolved_at: now, resolved_by: 'auto', healthy_streak: streak },
      }),
    );
    ids.resolved.push(alert._id);
  }

  const { result, duplicateIndexes } = await bulkWrite(ops);

  // Creates are ops[0..create.length). Upserted -> created; otherwise another batch won the race.
  const createdIds = [];
  const raced = [];
  plan.create.forEach(({ finding }, index) => {
    const upsertedId = result.upsertedIds?.[index];
    if (upsertedId && !duplicateIndexes.has(index)) createdIds.push(upsertedId);
    else raced.push(finding);
  });

  if (raced.length > 0) {
    const retry = await reapplyRacedFindings(raced, { messages, batchId, now });
    ids.escalated.push(...retry.escalated);
    ids.updated.push(...retry.updated);
  }

  return collectResults({ created: createdIds, ...ids });
}

async function reapplyRacedFindings(findings, { messages, batchId, now }) {
  const active = await findActiveByFingerprints(findings.map((f) => f.fingerprint));
  const byFingerprint = new Map(active.map((a) => [a.fingerprint, a]));
  const ops = [];
  const out = { escalated: [], updated: [] };

  for (const finding of findings) {
    const alert = byFingerprint.get(finding.fingerprint);
    if (!alert) continue; // resolved in between: nothing sensible to attach to
    const escalate = escalationReasons(alert, finding).reasons.length > 0;
    const message = escalate ? requireMessage(messages, finding.fingerprint) : null;
    ops.push(updateActive(alert._id, buildFindingUpdate(alert, finding, { batchId, message, now })));
    (escalate ? out.escalated : out.updated).push(alert._id);
  }
  if (ops.length > 0) await Alert.bulkWrite(ops, { ordered: false });
  return out;
}

async function collectResults(idGroups) {
  const allIds = Object.values(idGroups).flat();
  const docs = allIds.length ? await Alert.find({ _id: { $in: allIds } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d.toJSON()]));
  const pick = (list) => list.map((id) => byId.get(String(id))).filter(Boolean);
  return Object.fromEntries(Object.entries(idGroups).map(([key, list]) => [key, pick(list)]));
}

const SORTS = {
  severity: { severity_rank: -1, last_seen_at: -1 },
  last_seen: { last_seen_at: -1 },
};

/** Pure: Mongo filter for list queries (severity handled separately for counts). */
export function buildListFilter({ status = 'active', api_name, rule }) {
  const filter = {};
  if (status !== 'all') filter.status = status;
  if (api_name) filter.fingerprint = fingerprintFor(api_name);
  if (rule) filter['anomalies.rule'] = rule;
  return filter;
}

/**
 * List alerts with pagination. counts_by_severity covers the status/api/rule filter but
 * ignores the severity filter, so the UI summary shows totals for every severity.
 */
export async function listAlerts({
  status,
  severity = [],
  api_name,
  rule,
  page = 1,
  limit = 50,
  sort = 'severity',
}) {
  const base = buildListFilter({ status, api_name, rule });
  const filter = severity.length ? { ...base, severity: { $in: severity } } : base;

  const [docs, total, counts] = await Promise.all([
    Alert.find(filter)
      .sort(SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit),
    Alert.countDocuments(filter),
    Alert.aggregate([{ $match: base }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
  ]);

  const counts_by_severity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const { _id, count } of counts) counts_by_severity[_id] = count;

  return { data: docs.map((d) => d.toJSON()), total, counts_by_severity };
}

export async function getAlert(id) {
  const doc = await Alert.findById(id);
  if (!doc) throw new NotFoundError('Alert not found', { id });
  return doc.toJSON();
}

/** Manually resolve. Idempotent: an already-resolved alert is returned unchanged. */
export async function resolveAlert(id, { now = new Date() } = {}) {
  const updated = await Alert.findOneAndUpdate(
    { _id: id, status: 'active' },
    { $set: { status: 'resolved', resolved_at: now, resolved_by: 'manual' } },
    { returnDocument: 'after' },
  );
  if (updated) return updated.toJSON();
  return getAlert(id);
}
