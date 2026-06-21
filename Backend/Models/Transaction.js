const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    // `payer` / `recipient` are NOT required — a null value means
    // "the platform itself" is the counterparty. Examples:
    //   - appointment_fee : payer = patient,   recipient = doctor
    //   - pharmacy_order  : payer = patient,   recipient = pharmacy
    //   - lab_test_fee    : payer = patient,   recipient = lab
    //   - payout          : payer = null,      recipient = doctor/pharmacy/lab
    //   - refund          : payer = null,      recipient = patient
    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "EGP",
    },
    type: {
      type: String,
      enum: ["appointment_fee", "lab_test_fee", "pharmacy_order", "refund", "payout"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },

    // ── Platform Fee ──────────────────────────────────────────────────────────
    // 1.5% of the clinic session price — what the doctor owes the app this month
    platformFeeRate: {
      type: Number,
      default: 0.015, // 1.5%
    },
    platformFeeAmount: {
      type: Number,
      default: 0,
    },
    platformFeePaid: {
      type: Boolean,
      default: false,
    },

    // ── Payment method ────────────────────────────────────────────────────────
    paymentMethod: {
      type: String,
      enum: ["cash", "online"],
      default: "cash",
    },

    // ── Relation ──────────────────────────────────────────────────────────────
    relatedModel: {
      type: String,
      enum: ["Appointment", "Order"], // ✅ أضف Order
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "relatedModel",
    },

    note: { type: String },
  },
  { timestamps: true }
);

// Safety net: a transaction must involve at least one real party.
// Both `payer` and `recipient` being null at the same time means the
// platform is paying itself, which is never a valid transaction.
transactionSchema.pre("validate", function () {
  if (!this.payer && !this.recipient) {
    throw new Error("Transaction must have at least one of payer or recipient");
  }
});

// ── Monthly summary helper ────────────────────────────────────────────────────
// Returns total platformFeeAmount owed by a doctor for a given month.
// Usage: await Transaction.monthlyFeeOwed(doctorUserId, year, month)
transactionSchema.statics.monthlyFeeOwed = async function (
  doctorUserId,
  year,
  month
) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const result = await this.aggregate([
    {
      $match: {
        recipient: new mongoose.Types.ObjectId(doctorUserId),
        status: "completed",
        createdAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        totalFee: { $sum: "$platformFeeAmount" },
        totalRevenue: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  return result[0] ?? { totalFee: 0, totalRevenue: 0, count: 0 };
};

module.exports = mongoose.model("Transaction", transactionSchema);