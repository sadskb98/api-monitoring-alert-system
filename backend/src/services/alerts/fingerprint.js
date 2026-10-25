/**
 * Pure: identity key for an API. One active alert exists per fingerprint.
 * Trimmed, internal whitespace collapsed, case-insensitive.
 */
export function fingerprintFor(apiName) {
  return apiName.trim().replace(/\s+/g, ' ').toLowerCase();
}
