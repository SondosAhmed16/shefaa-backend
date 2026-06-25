const mongoose = require("mongoose");

const pharmacySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    commercialRegisterNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    medicalLicencePdf: { type: String },

    rating: { type: Number, default: 4.8 },
    totalReviews: { type: Number, default: 0 },

    alwaysOpen: { type: Boolean, default: false },
    openNow: { type: Boolean, default: true },
    deliveryAvailable: { type: Boolean, default: true },
    prescriptionOnly: { type: Boolean, default: false },

    // ── Visibility ─────────────────────────────────────────────────────
    // "active"  → normal, visible to patients
    // "hidden"  → overdue payment — hidden from public APIs
    // "suspended" → manually suspended by admin
    visibilityStatus: {
      type: String,
      enum: ["active", "hidden", "suspended"],
      default: "active",
    },
    hiddenAt: { type: Date, default: null },
    hiddenReason: { type: String, default: null },

    // ── Financial / Commission ─────────────────────────────────────────
    commissionRate: {
      type: Number,
      default: 1, // 1 % per completed order
    },

    // Running totals (updated on each order completion)
    financials: {
      totalRevenue: { type: Number, default: 0 },       // sum of all completed order totals
      totalCommission: { type: Number, default: 0 },    // sum of app commissions
      totalNetEarnings: { type: Number, default: 0 },   // revenue – commission
      currentDue: { type: Number, default: 0 },         // unpaid commission owed to app
      lastPaidAmount: { type: Number, default: 0 },
      lastPaidAt: { type: Date, default: null },
      paymentStatus: {
        type: String,
        enum: ["up_to_date", "due", "overdue"],
        default: "up_to_date",
      },
      overdueAt: { type: Date, default: null },
    },

    // ── Delivery ───────────────────────────────────────────────────────
    deliveryTime: { type: String, default: "30 min" },
    deliveryFee: { type: Number, default: 0 },           // default fee
    minimumOrder: { type: Number, default: 0 },

    // Per-city delivery pricing
    cityDeliveryPrices: [
      {
        city: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
      },
    ],

    deliveryArea: [{ type: String }],

    // ── Profile ────────────────────────────────────────────────────────
    phone: { type: String },
    about: { type: String },
    workingHours: [
      {
        days: { type: String, required: true },
        time: { type: String, required: true },
      },
    ],

    services: [{ type: String }],

    paymentMethods: [
      {
        type: String,
        enum: [
          "Cash",
          "Visa",
          "Mastercard",
          "Instapay",
          "Meeza",
          "Vodafone Cash",
          "Etisalat Cash",
          "Orange Cash",
        ],
      },
    ],

    licenseExpiry: { type: String, default: "" },

    addresses: [
      {
        addressText: { type: String, required: true },
        location: {
          type: { type: String, enum: ["Point"], default: "Point" },
          coordinates: { type: [Number] },
        },
      },
    ],
    // Add this to your pharmacySchema fields:
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] }
    },
  },
  { timestamps: true }
);

pharmacySchema.index({ "location": "2dsphere" });

module.exports = mongoose.model("Pharmacy", pharmacySchema);