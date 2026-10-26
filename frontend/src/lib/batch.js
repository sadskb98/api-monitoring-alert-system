/**
 * Pure: quick client-side check of the batch editor text before it is sent.
 * The backend remains the real validator (per-record errors come back in `rejected`).
 * @returns {{ ok: true, count: number } | { ok: false, message: string }}
 */
export function checkBatchText(text) {
  if (text.trim() === '') return { ok: false, message: 'Paste a batch or load a sample' };
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: `Invalid JSON: ${withLine(err.message, text)}` };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: false, message: 'The batch is empty' };
    return { ok: true, count: value.length };
  }
  if (value !== null && typeof value === 'object') return { ok: true, count: 1 };
  return { ok: false, message: 'Expected a JSON array of observations (or a single object)' };
}

/**
 * Engine messages differ: add "(line N)" when only a position is given, and flatten
 * V8's "Unexpected token" snippets (which can contain newlines) onto one line.
 */
function withLine(rawMessage, text) {
  const message = rawMessage.replace(/\s+/g, ' ').trim();
  if (/line \d+/i.test(message)) return message;
  const match = /position (\d+)/i.exec(message);
  if (!match) return message;
  const line = text.slice(0, Number(match[1])).split('\n').length;
  return `${message} (line ${line})`;
}

/** Pure: human summary of the batch's LLM outcome (POST /monitor `llm`). */
export function describeLlm(llm) {
  if (!llm) return { tone: 'neutral', label: 'Unknown' };
  const latency = llm.latency_ms !== null && llm.latency_ms !== undefined ? `${llm.latency_ms} ms` : null;
  const retries = llm.attempts > 1 ? `${llm.attempts} attempts` : null;
  const extra = [llm.model, latency, retries].filter(Boolean).join(' · ');
  switch (llm.status) {
    case 'ok':
      return { tone: 'ai', label: 'AI-generated', detail: extra };
    case 'partial':
      return { tone: 'warn', label: 'Partly AI-generated; some alerts used templates', detail: extra };
    case 'fallback':
      return { tone: 'warn', label: 'Template fallback (LLM call failed)', detail: retries };
    case 'disabled':
      return { tone: 'neutral', label: 'Templates (LLM disabled)' };
    case 'skipped':
      return { tone: 'neutral', label: 'No new alert text needed' };
    default:
      return { tone: 'neutral', label: llm.status };
  }
}
