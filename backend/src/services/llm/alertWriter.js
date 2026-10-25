import { setTimeout as delay } from 'node:timers/promises';
import { compareSeverity } from '../../lib/severity.js';
import { checkFacts } from './factCheck.js';
import { createGeminiClient } from './geminiClient.js';
import {
  RESPONSE_JSON_SCHEMA,
  SYSTEM_INSTRUCTION,
  buildPromptItems,
  buildUserContent,
  llmEnvelopeSchema,
  llmItemSchema,
} from './prompt.js';
import { withRetry } from './retry.js';
import { renderTemplate } from './templates.js';

/** Pure: most severe first (stable), so the item cap drops the least important ones. */
function bySeverity(requests) {
  return [...requests].sort((a, b) => compareSeverity(b.finding.severity, a.finding.severity));
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/**
 * Pure: turn the raw LLM text into per-id outcomes.
 * @returns {{ error: { reason, detail } } | { byId: Map<string, unknown> }}
 */
export function parseLlmResponse(text) {
  const json = parseJson(text);
  if (!json.ok) return { error: { reason: 'invalid_json', detail: json.detail } };
  const envelope = llmEnvelopeSchema.safeParse(json.value);
  if (!envelope.success) return { error: { reason: 'invalid_response_shape', detail: 'missing alerts[]' } };
  const byId = new Map();
  for (const item of envelope.data.alerts) {
    const id = item && typeof item === 'object' ? item.id : undefined;
    if (typeof id === 'string' && !byId.has(id)) byId.set(id, item); // first answer per id wins
  }
  return { byId };
}

/**
 * Pure: validate and fact-check one LLM item against its finding.
 * @returns {{ ok: true, message } | { ok: false, reason, detail }}
 */
export function acceptItem(raw, finding) {
  if (raw === undefined) return { ok: false, reason: 'missing_item', detail: 'no output for this id' };
  const parsed = llmItemSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: 'invalid_item', detail: `${issue.path.join('.')}: ${issue.message}` };
  }
  const { title, message, suggested_action } = parsed.data;
  const facts = checkFacts(message, finding);
  if (!facts.ok)
    return { ok: false, reason: 'fact_check_failed', detail: `missing ${facts.missing.join(', ')}` };
  return { ok: true, message: { title, message, suggested_action, message_source: 'llm' } };
}

/** Pure: batch-level LLM status from per-item sources. */
function overallStatus(llmCount, total) {
  if (llmCount === total) return 'ok';
  return llmCount === 0 ? 'fallback' : 'partial';
}

/**
 * Writes alert text for the creates/escalations of one batch.
 * One LLM call per batch (capped at llm.maxItems, most severe first); any item the LLM
 * does not answer correctly gets template text. Never throws for LLM problems.
 *
 * @param {object} deps
 * @param {object} deps.llm          config.llm ({ enabled, apiKey, model, timeoutMs, maxRetries, maxItems })
 * @param {object} deps.thresholds   config.thresholds
 * @param {object|null} [deps.client] { generateJson }; defaults to Gemini when enabled, null when disabled
 */
export function createAlertWriter({
  llm,
  thresholds,
  client = llm.enabled ? createGeminiClient(llm) : null,
  sleep = delay,
  random = Math.random,
  now = () => performance.now(),
}) {
  /**
   * @param {{ finding, escalation }[]} requests  from dedup.messageRequests()
   * @returns {Promise<{ messages: Map<string, object>, llm: { status, attempts, latency_ms, fallbacks } }>}
   */
  async function writeMessages(requests, { log }) {
    const messages = new Map();
    const fallbacks = [];
    const useTemplate = ({ finding }, reason, detail = null) => {
      messages.set(finding.fingerprint, renderTemplate(finding, thresholds));
      fallbacks.push({ api_name: finding.api_name, reason });
      log.warn(
        { api_name: finding.api_name, fingerprint: finding.fingerprint, reason, detail },
        'Alert text fell back to template',
      );
    };
    const summary = (status, attempts = 0, latency_ms = null) => ({
      messages,
      llm: { status, attempts, latency_ms, fallbacks },
    });

    if (requests.length === 0) return summary('skipped');
    if (!client) {
      requests.forEach((r) => useTemplate(r, 'llm_disabled'));
      return summary('disabled');
    }

    const ordered = bySeverity(requests);
    const sent = ordered.slice(0, llm.maxItems);
    ordered
      .slice(llm.maxItems)
      .forEach((r) => useTemplate(r, 'over_item_cap', `LLM_MAX_ITEMS=${llm.maxItems}`));

    const userContent = buildUserContent(buildPromptItems(sent, thresholds));
    const started = now();
    const call = await withRetry(
      () =>
        client.generateJson({
          systemInstruction: SYSTEM_INSTRUCTION,
          userContent,
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          log,
        }),
      { maxRetries: llm.maxRetries, log, sleep, random, now },
    );
    const latency = Math.round(now() - started);

    if (!call.ok) {
      const { reason, status, detail } = call.failure;
      const why = `${status ? `status ${status} ` : ''}after ${call.attempts} attempt(s): ${detail}`;
      sent.forEach((r) => useTemplate(r, reason, why));
      return summary('fallback', call.attempts, latency);
    }

    const parsed = parseLlmResponse(call.value);
    let llmCount = 0;
    sent.forEach((request, i) => {
      if (parsed.error) return useTemplate(request, parsed.error.reason, parsed.error.detail);
      const outcome = acceptItem(parsed.byId.get(`a${i + 1}`), request.finding);
      if (!outcome.ok) return useTemplate(request, outcome.reason, outcome.detail);
      messages.set(request.finding.fingerprint, outcome.message);
      llmCount++;
    });

    // latency_ms spans all attempts and backoff; attempt_ms is the successful request alone.
    log.info(
      {
        model: client.model,
        items: requests.length,
        llm_items: llmCount,
        attempts: call.attempts,
        latency_ms: latency,
        attempt_ms: call.attempt_ms,
      },
      'LLM alert text generated',
    );
    return summary(overallStatus(llmCount, requests.length), call.attempts, latency);
  }

  return { writeMessages };
}
