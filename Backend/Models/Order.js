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
    shippingAddress: {
      fullName: { type: String },
      phone: { type: String },
      cityDistrict: { type: String },
      streetAddress: { type: String }
    },
    orderNumber: {
      type: String,
      required: true,
      unique: true // يتم توليده تلقائياً مثل: PHX-1082
    },
    orderType: {
      type: String,
      enum: ["Delivery", "Pickup"],
      default: "Delivery"
    },
    status: {
      type: String,
      enum: ["New", "Preparing", "Ready", "Shipped", "Completed"],
      default: "New"
    },
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
        price: { type: Number, required: true } // سعر الدواء وقت الشراء (Snapshot)
      }
    ],
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },     // 0 إذا كان Pickup
    discount: { type: Number, default: 0 },     // من كود الخصم (Promo Code)
    totalPrice: { type: Number, required: true }, // subtotal + deliveryFee - discount
    paymentMethod: {
      type: String,
      enum: ["Cash", "Visa", "Fawry", "Vodafone Cash", "Instapay"],
      default: "Cash"
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid"],
      default: "Pending"
    },
    deliveryManId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryMan",
      default: null
    },
    deliveryAddress: {
      addressText: { type: String },
      location: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number] } // [lng, lat]
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);