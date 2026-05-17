const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    orderNumber: {
      type: String,
      required: true,
      unique: true
      // generated: e.g. "PHX-1082"
    },

    orderType: {
      type: String,
      enum: ["Delivery"],
      default: "Delivery"
    },

    status: {
      type: String,
      enum: ["New", "Preparing", "Ready", "Shipped", "Completed"],
      default: "New"
    },

    // تاريخ كل تغيير في الستاتوس — بيظهر في الـ tracking timeline بتاع البيشنت
    statusHistory: [
      {
        status: { type: String },
        changedAt: { type: Date, default: Date.now },
        note: { type: String }
      }
    ],

    items: [
      {
        medicineId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "MedicineStock",
          required: true
        },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true }   // snapshot وقت الطلب
      }
    ],

    subtotal:    { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },     // 0 لو Pickup
    discount:    { type: Number, default: 0 },     // من promo code
    totalPrice:  { type: Number, required: true }, // subtotal + deliveryFee - discount

    paymentMethod: {
      type: String,
      enum: ["Cash", "Visa", "Fawry", "Vodafone Cash"],
      default: "Cash"
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid"],
      default: "Pending"
    },

    // Delivery info
    deliveryManId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryMan",
      default: null
    },

    deliveryAddress: {
      addressText: { type: String },               // "12 Nasr City St, Apt 3"
      location: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number] }            // [lng, lat]
      }
    },

    estimatedTime: { type: String }, 
    deliveredAt: { type: Date },
    confirmedByUserAt: { type: Date },
  },
  { timestamps: true }
);

orderSchema.index({ "deliveryAddress.location": "2dsphere" });

module.exports = mongoose.model("Order", orderSchema);