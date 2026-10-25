import { describe, expect, it } from 'vitest';
import { fingerprintFor } from '../../../src/services/alerts/fingerprint.js';

describe('fingerprintFor', () => {
  it('normalizes case, surrounding and repeated whitespace', () => {
    expect(fingerprintFor('AppointmentAPI')).toBe('appointmentapi');
    expect(fingerprintFor('  Patient   Data API ')).toBe('patient data api');
    expect(fingerprintFor('APPOINTMENTAPI')).toBe(fingerprintFor('appointmentApi'));
  });
});
