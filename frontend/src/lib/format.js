/** Pure: "just now", "12s ago", "3m ago", "2h ago", "4d ago". */
export function relativeTime(value, now = Date.now()) {
  if (value === null || value === undefined) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Pure: "10:02:11" today, "Oct 24, 10:02" otherwise. */
export function formatTime(value, now = Date.now()) {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}

/** Pure: plain digits, matching the alert text ("5500 ms"). */
export const formatMs = (ms) => (ms === null || ms === undefined ? '—' : `${ms} ms`);

export const formatValue = (value) => (value === null || value === undefined ? '—' : String(value));

/** Pure: "65f2a1…9c0e" for long ids, unchanged for short ones. */
export const shortId = (id) => (id && id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : (id ?? ''));

/**
 * Pure: alert titles start with the API name ("AppointmentAPI: server error"); the row already shows
 * the name, so drop it there. Titles that don't start with the name are left alone.
 */
export function displayTitle(title, apiName) {
  if (!title || !apiName || !title.toLowerCase().startsWith(apiName.toLowerCase())) return title;
  const rest = title.slice(apiName.length).replace(/^\s*[:\-–—|]?\s*/, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title;
}
