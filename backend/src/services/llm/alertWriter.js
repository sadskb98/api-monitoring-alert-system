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

/**
 * Primary-model failures (after its retries) that are worth trying another model for:
 * capacity and quota are per model (free-tier quotas included); a bad request is not.
 */
const FALLBACK_REASONS = new Set(['unavailable', 'timeout', 'rate_limited']);

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
 * If the primary model's retries end in 503/UNAVAILABLE, a timeout or a 429, each fallback
 * model is tried once, in order, before giving up to templates. 400 and other 4xx go
 * straight to templates.
 *
 * @param {object} deps
 * @param {object} deps.llm          config.llm ({ enabled, apiKey, model, fallbackModels, timeoutMs, ... })
 * @param {object} deps.thresholds   config.thresholds
 * @param {object|null} [deps.client] { model, generateJson }; defaults to Gemini when enabled, null when disabled
 * @param {object[]} [deps.fallbackClients] one client per llm.fallbackModels entry
 */
export function createAlertWriter({
  llm,
  thresholds,
  client = llm.enabled ? createGeminiClient(llm) : null,
  fallbackClients = llm.enabled
    ? (llm.fallbackModels ?? []).map((model) => createGeminiClient({ ...llm, model }))
    : [],
  sleep = delay,
  random = Math.random,
  now = () => performance.now(),
}) {
  /**
   * @param {{ finding, escalation }[]} requests  from dedup.messageRequests()
   * @returns {Promise<{ messages: Map<string, object>, llm: { status, model, attempts, latency_ms, fallbacks } }>}
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
    // model: the model that wrote the LLM text, null when no item came from the LLM
    const summary = (status, attempts = 0, latency_ms = null, model = null) => ({
      messages,
      llm: { status, model, attempts, latency_ms, fallbacks },
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
    const callModel = (c, maxRetries) =>
      withRetry(
        () =>
          c.generateJson({
            systemInstruction: SYSTEM_INSTRUCTION,
            userContent,
            responseJsonSchema: RESPONSE_JSON_SCHEMA,
            log,
          }),
        { maxRetries, log, sleep, random, now },
      );

    const started = now();
    let used = client;
    let call = await callModel(client, llm.maxRetries);
    let attempts = call.attempts;
    if (!call.ok && FALLBACK_REASONS.has(call.failure.reason)) {
      for (const fallback of fallbackClients) {
        log.warn(
          { from_model: used.model, model: fallback.model, reason: call.failure.reason },
          'Trying fallback model',
        );
        used = fallback;
        call = await callModel(fallback, 0); // each fallback model gets one attempt
        attempts += call.attempts;
        if (call.ok) break;
      }
    }
    const latency = Math.round(now() - started);

    if (!call.ok) {
      const { reason, status, detail } = call.failure;
      const tried = [client, ...fallbackClients.slice(0, fallbackClients.indexOf(used) + 1)];
      const why =
        `${status ? `status ${status} ` : ''}after ${attempts} attempt(s) ` +
        `(models: ${tried.map((c) => c.model).join(', ')}): ${detail}`;
      sent.forEach((r) => useTemplate(r, reason, why));
      return summary('fallback', attempts, latency);
    }

    const parsed = parseLlmResponse(call.value);
    let llmCount = 0;
    sent.forEach((request, i) => {
      if (parsed.error) return useTemplate(request, parsed.error.reason, parsed.error.detail);
      const outcome = acceptItem(parsed.byId.get(`a${i + 1}`), request.finding);
      if (!outcome.ok) return useTemplate(request, outcome.reason, outcome.detail);
      messages.set(request.finding.fingerprint, { ...outcome.message, message_model: used.model });
      llmCount++;
    });

    // latency_ms spans all attempts and backoff; attempt_ms is the successful request alone.
    log.info(
      {
        model: used.model,
        fallback_model_used: used !== client,
        items: requests.length,
        llm_items: llmCount,
        attempts,
        latency_ms: latency,
        attempt_ms: call.attempt_ms,
      },
      'LLM alert text generated',
    );
    const status = overallStatus(llmCount, requests.length);
    return summary(status, attempts, latency, llmCount > 0 ? used.model : null);
  }

  return { writeMessages };
}
