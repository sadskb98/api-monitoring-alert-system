import mongoose from 'mongoose';
import { SEVERITIES } from '../lib/severity.js';
import { CATEGORIES, RULES } from '../services/detection/rules.js';

const { Schema } = mongoose;

const anomalySchema = new Schema(
  {
    rule: { type: String, enum: Object.keys(RULES), required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
  },
  { _id: false },
);

const observationSchema = new Schema(
  {
    response_time_ms: { type: Number, default: null },
    status_code: { type: Number, default: null },
    records_returned: { type: Number, default: null },
    observed_at: { type: Date, required: true },
    invalid_fields: { type: [{ field: String, message: String, _id: false }], default: [] },
  },
  { _id: false },
);

const alertSchema = new Schema(
  {
    fingerprint: { type: String, required: true },
    api_name: { type: String, required: true },

    anomalies: { type: [anomalySchema], required: true },
    seen_rules: { type: [String], default: [] },
    severity: { type: String, enum: SEVERITIES, required: true },
    severity_rank: { type: Number, required: true }, // numeric copy of severity for correct sorting
    peak_severity: { type: String, enum: SEVERITIES, required: true },
    status: { type: String, enum: ['active', 'resolved'], default: 'active', required: true },

    title: { type: String, required: true },
    message: { type: String, required: true },
    suggested_action: { type: String, default: null },
    message_source: { type: String, enum: ['llm', 'template'], required: true },
    message_generated_at: { type: Date, required: true },

    last_observation: { type: observationSchema, required: true },
    stats: {
      occurrences: { type: Number, default: 0 },
      max_response_time_ms: { type: Number, default: null },
      min_records_returned: { type: Number, default: null },
    },
    healthy_streak: { type: Number, default: 0 },

    first_seen_at: { type: Date, required: true },
    last_seen_at: { type: Date, required: true },
    resolved_at: { type: Date, default: null },
    resolved_by: { type: String, enum: ['auto', 'manual', null], default: null },
    last_batch_id: { type: Schema.Types.ObjectId, default: null },
    notified_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.severity_rank;
        return ret;
      },
    },
  },
);

// At most one ACTIVE alert per API. Resolved alerts are history and may repeat.
alertSchema.index(
  { fingerprint: 1 },
  { unique: true, partialFilterExpression: { status: 'active' }, name: 'uniq_active_fingerprint' },
);
alertSchema.index({ status: 1, severity_rank: -1, last_seen_at: -1 }, { name: 'list_by_severity' });
alertSchema.index({ status: 1, last_seen_at: -1 }, { name: 'list_by_last_seen' });

export const Alert = mongoose.models.Alert ?? mongoose.model('Alert', alertSchema);
