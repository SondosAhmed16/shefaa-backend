const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deliveryManId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryMan",
      default: null,
    },
    prescriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
      default: null,
    },

    orderNumber: { type: String, unique: true },

    items: [
      {
        medicineId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "MedicineStock",
        },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true },
      },
    ],

    orderType: {
      type: String,
      enum: ["Delivery", "Pickup"],
      default: "Delivery",
    },

    status: {
      type: String,
      enum: ["New", "Preparing", "Ready", "Completed", "Cancelled"],
      default: "New",
    },

    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        note: String,
      },
    ],

    // ── NEW: dual confirmation before an order is truly "Completed" ─────
    // Both flags must be true before commission/Transaction logic runs.
    pharmacyConfirmedCompletion: { type: Boolean, default: false },
    pharmacyConfirmedAt:         { type: Date, default: null },
    patientConfirmedCompletion:  { type: Boolean, default: false },
    patientConfirmedAt:          { type: Date, default: null },
    completedAt:                 { type: Date, default: null },

    deliveryAddress: {
      addressText:   { type: String },
      fullName:      { type: String },
      phoneNumber:   { type: String },
      cityDistrict:  { type: String },
      streetAddress: { type: String },
      location: {
        type:        { type: String, default: "Point" },
        coordinates: { type: [Number] },
      },
    },

    paymentMethod: {
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
      default: "Cash",
    },

    // ── NEW: tracks whether the patient has paid ───────────────────────
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed", "Refunded"],
      default: "Pending",
    },

    // ── Financial fields ───────────────────────────────────────────────
    subtotal:    { type: Number, default: 0 },       // order total before delivery & discount
    deliveryFee: { type: Number, default: 0 },       // delivery fee charged
    discount:    { type: Number, default: 0 },       // NEW: promo/discount amount
    totalPrice:  { type: Number, required: true },   // subtotal + deliveryFee - discount

    // Commission (calculated server-side, never trusted from client)
    commissionRate:   { type: Number, default: 1 },  // % at time of order
    commissionAmount: { type: Number, default: 0 },  // totalPrice * commissionRate / 100
    pharmacyEarning:  { type: Number, default: 0 },  // totalPrice - commissionAmount

    // Payment to app
    commissionPaid:         { type: Boolean, default: false },
    commissionPaidAt:       { type: Date, default: null },
    commissionPaidInCycleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MonthlyPayment",
      default: null,
    },

    estimatedTime: { type: String },
  },
  { timestamps: true }
);

// Auto-generate orderNumber before save
orderSchema.pre("save", async function () {
  if (!this.orderNumber) {
    const rand = Math.floor(10000 + Math.random() * 90000);
    this.orderNumber = `ORD-${rand}`;
  }
});

module.exports = mongoose.model("Order", orderSchema);