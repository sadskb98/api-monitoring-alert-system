import { compareSeverity, isAtLeast } from '../../lib/severity.js';

/** Only new and worsened alerts are emailed; touches/resolves are not news worth a page. */
const NOTIFY_ACTIONS = new Set(['created', 'escalated']);
const SUBJECT_PREFIX = '[API Monitor]';

/**
 * Pure: batch response items worth emailing (created/escalated at or above minSeverity),
 * most severe first.
 */
export function selectForDigest(items, minSeverity) {
  return items
    .filter((item) => NOTIFY_ACTIONS.has(item.action) && isAtLeast(item.severity, minSeverity))
    .sort((a, b) => compareSeverity(b.severity, a.severity) || a.api_name.localeCompare(b.api_name));
}

/** Pure: "1 critical, 2 high" in severity order. */
function severityCounts(items) {
  const counts = new Map();
  for (const { severity } of items) counts.set(severity, (counts.get(severity) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => compareSeverity(b, a))
    .map(([severity, n]) => `${n} ${severity}`)
    .join(', ');
}

export function digestSubject(items) {
  if (items.length === 1) {
    const [item] = items;
    return `${SUBJECT_PREFIX} ${item.severity.toUpperCase()} ${item.title}`;
  }
  return `${SUBJECT_PREFIX} ${items.length} alerts (${severityCounts(items)})`;
}

const sourceLabel = (item) =>
  item.message_source === 'llm' ? `AI-generated (${item.message_model ?? 'unknown model'})` : 'Template';
const anomalyList = (item) => item.anomalies.map((a) => `${a.rule} (${a.severity})`).join(', ');

function textBlock(item) {
  return [
    `[${item.severity.toUpperCase()}] ${item.api_name} - ${item.action}`,
    item.title,
    item.message,
    item.suggested_action ? `Suggested action: ${item.suggested_action}` : null,
    `Anomalies: ${anomalyList(item)}`,
    `Text: ${sourceLabel(item)} | Alert id: ${item.alert_id}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const SEVERITY_COLORS = { critical: '#b42318', high: '#c4320a', medium: '#b54708', low: '#475467' };

function htmlBlock(item) {
  const e = escapeHtml;
  const color = SEVERITY_COLORS[item.severity];
  return `<div style="border-left:4px solid ${color};padding:8px 12px;margin:0 0 16px">
  <div style="font-size:12px;color:${color};font-weight:600">${e(item.severity.toUpperCase())} · ${e(item.api_name)} · ${e(item.action)}</div>
  <div style="font-size:16px;font-weight:600;margin:4px 0">${e(item.title)}</div>
  <p style="margin:4px 0">${e(item.message)}</p>
  ${item.suggested_action ? `<p style="margin:4px 0"><strong>Suggested action:</strong> ${e(item.suggested_action)}</p>` : ''}
  <div style="font-size:12px;color:#475467">Anomalies: ${e(anomalyList(item))}<br>Text: ${e(sourceLabel(item))} · Alert id: ${e(item.alert_id)}</div>
</div>`;
}

/**
 * Pure: email content for one batch's digest.
 * @param {object[]} items   output of selectForDigest (non-empty)
 * @param {object}   batch   { batch_id, source, min_severity }
 * @returns {{ subject, text, html }}
 */
export function buildDigest(items, { batch_id, source, min_severity }) {
  const intro = `${items.length} alert(s) at or above ${min_severity} from batch ${batch_id} (${source}).`;
  return {
    subject: digestSubject(items),
    text: ['API Monitor alert digest', intro, '', items.map(textBlock).join('\n\n')].join('\n'),
    html: `<div style="font-family:system-ui,sans-serif;max-width:640px">
<h2 style="margin:0 0 4px">API Monitor alert digest</h2>
<p style="margin:0 0 16px;color:#475467">${escapeHtml(intro)}</p>
${items.map(htmlBlock).join('\n')}
</div>`,
  };
}
