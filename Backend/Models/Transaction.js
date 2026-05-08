const mongoose = require('mongoose');

/**
 * Transaction Model
 * Tracks all financial movements on the platform.
 *
 * type:
 *   - 'appointment_fee'  → patient pays for a booking
 *   - 'lab_test_fee'     → patient pays for a lab test
 *   - 'pharmacy_order'   → patient pays for a pharmacy order
 *   - 'refund'           → money returned to patient
 *   - 'payout'           → platform pays out a doctor / pharmacy / lab
 *
 * status:
 *   - 'pending'   → created but not confirmed
 *   - 'completed' → money moved successfully
 *   - 'failed'    → payment gateway rejected
 *   - 'refunded'  → completed then reversed
 */
const transactionSchema = new mongoose.Schema(
  {
    // ── Who is involved ───────────────────────────────────────────────────────
    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,          // null for platform-initiated payouts
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,          // null when money goes to platform wallet
    },

    // ── What it's linked to ───────────────────────────────────────────────────
    relatedModel: {
      type: String,
      enum: ['Appointment', 'Order', 'LabTest', null],
      default: null,
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // ── Money ─────────────────────────────────────────────────────────────────
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'EGP',
      uppercase: true,
      trim: true,
    },

    // ── Classification ────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['appointment_fee', 'lab_test_fee', 'pharmacy_order', 'refund', 'payout'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },

    // ── Gateway details (optional — fill when a real gateway is wired) ────────
    gatewayTxId: {
      type: String,
      default: null,          // e.g. Stripe charge id, Fawry ref, etc.
      trim: true,
    },
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // ── Human-readable note ───────────────────────────────────────────────────
    note: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,         // createdAt + updatedAt
  }
);

// ── Indexes for common admin queries ──────────────────────────────────────────
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ payer: 1 });
transactionSchema.index({ recipient: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);