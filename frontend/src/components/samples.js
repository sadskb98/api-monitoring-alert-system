/** Ready-made batches for the submit panel (demo and manual testing). */
const SPEC_EXAMPLE = [
  { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
  { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 },
];

// With ALERT_RESOLVE_AFTER_HEALTHY=1 (the default) one healthy record resolves AppointmentAPI.
const RECOVERY = [
  { api_name: 'AppointmentAPI', response_time_ms: 640, status_code: 200, records_returned: 38 },
  { api_name: 'PatientDataAPI', response_time_ms: 980, status_code: 200, records_returned: 52 },
];

const MIXED = [
  { api_name: 'PatientDataAPI', response_time_ms: 1100, status_code: 200, records_returned: 48 },
  { api_name: 'BillingAPI', response_time_ms: 310, status_code: 401, records_returned: 0 },
  { api_name: 'NotificationAPI', response_time_ms: 220, status_code: 429, records_returned: 0 },
  { api_name: 'SearchAPI', response_time_ms: 3400, status_code: 200, records_returned: 120 },
  { api_name: 'InventoryAPI', response_time_ms: 450, status_code: 200, records_returned: 0 },
  // Malformed metric: kept and flagged as INVALID_PAYLOAD
  { api_name: 'ReportingAPI', response_time_ms: 'fast', status_code: 200, records_returned: 12 },
  // No api_name: can't be attributed, so the backend rejects this record
  { response_time_ms: 800, status_code: 200, records_returned: 5 },
];

const pretty = (records) => JSON.stringify(records, null, 2);

export const SAMPLES = Object.freeze([
  {
    id: 'spec',
    label: 'Spec example',
    hint: 'PatientDataAPI healthy, AppointmentAPI 500',
    text: pretty(SPEC_EXAMPLE),
  },
  {
    id: 'recovery',
    label: 'Recovery',
    hint: 'AppointmentAPI healthy again (auto-resolves)',
    text: pretty(RECOVERY),
  },
  {
    id: 'mixed',
    label: 'Mixed',
    hint: '401, 429, slow, zero records, malformed field, missing api_name',
    text: pretty(MIXED),
  },
]);

export const DEFAULT_BATCH_TEXT = SAMPLES[0].text;
