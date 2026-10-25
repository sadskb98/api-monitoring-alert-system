import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Audit record for each ingested batch (HTTP or file). Kept indefinitely. */
const batchSchema = new Schema(
  {
    source: { type: String, enum: ['http', 'file'], required: true },
    request_id: { type: String, default: null },
    received: { type: Number, required: true },
    accepted: { type: Number, required: true },
    rejected: { type: Number, required: true },
    findings: { type: Number, required: true },
    alerts: {
      created: { type: Number, default: 0 },
      escalated: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      resolved: { type: Number, default: 0 },
    },
    llm: {
      status: {
        type: String,
        enum: ['ok', 'partial', 'fallback', 'skipped', 'disabled'],
        default: 'skipped',
      },
      attempts: { type: Number, default: 0 },
      latency_ms: { type: Number, default: null },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

batchSchema.index({ createdAt: -1 });

export const Batch = mongoose.models.Batch ?? mongoose.model('Batch', batchSchema);
