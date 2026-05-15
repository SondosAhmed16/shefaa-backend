const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
      enum: ["appointment_fee"],
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
      enum: ["Appointment"],
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "relatedModel",
    },

    note: { type: String },
  },
  { timestamps: true }
);

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