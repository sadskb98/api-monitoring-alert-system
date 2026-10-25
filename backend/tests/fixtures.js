import { detect } from '../src/services/detection/detector.js';

/** Spec section 5 example input, verbatim. */
export const SPEC_EXAMPLE = Object.freeze([
  { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
  { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 },
]);

export const THRESHOLDS = Object.freeze({ latencyWarningMs: 2000, latencyCriticalMs: 5000 });

let seq = 0;
/** Build a normalized observation (as produced by parseObservation). */
export function obs(overrides = {}) {
  const api_name = overrides.api_name ?? 'TestAPI';
  return {
    index: seq++,
    api_name,
    fingerprint: api_name.trim().replace(/\s+/g, ' ').toLowerCase(),
    response_time_ms: 100,
    status_code: 200,
    records_returned: 10,
    observed_at: new Date('2026-10-25T10:00:00Z'),
    invalid_fields: [],
    ...overrides,
  };
}

/** The combined finding the real detector produces for these records (one API). */
export function findingOf(...overrides) {
  return detect(overrides.map(obs), THRESHOLDS).findings[0];
}

/** Spec example AppointmentAPI record as a detector finding: 500, 5500 ms, 0 records. */
export const specFinding = () =>
  findingOf({ api_name: 'AppointmentAPI', status_code: 500, response_time_ms: 5500, records_returned: 0 });
