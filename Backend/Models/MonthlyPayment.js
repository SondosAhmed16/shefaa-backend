/**
 * MonthlyPayment
 * One document per pharmacy per billing month.
 * Records total commission owed, payment status, and history.
 */
const mongoose = require("mongoose");

const monthlyPaymentSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true,
    },

    // Billing period: e.g. year=2025, month=5 → May 2025
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 }, // 1–12

    // Aggregated from completed orders in that month
    totalOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
    totalNetEarnings: { type: Number, default: 0 },

    // Payment state
    // "pending"  → within the 3-day window, not yet paid
    // "paid"     → pharmacy confirmed payment
    // "overdue"  → window closed, not paid
    status: {
      type: String,
      enum: ["pending", "paid", "overdue"],
      default: "pending",
    },

    paidAt: { type: Date, default: null },
    paidAmount: { type: Number, default: 0 },

    // Admin can mark as resolved even if overdue
    resolvedByAdmin: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    resolvedNote: { type: String, default: null },

    // Reference to individual orders included in this cycle
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  },
  { timestamps: true }
);

// Unique constraint: one record per pharmacy per month
monthlyPaymentSchema.index({ pharmacyId: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("MonthlyPayment", monthlyPaymentSchema);