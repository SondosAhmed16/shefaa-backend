const mongoose = require("mongoose");

const deliveryManSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phones: [
      {
        type: String,
        required: true
      }
    ],
    vehicle: {
      type: String,
      enum: ["Motorcycle", "Bicycle", "Car", "Electric Scooter", "On Foot"],
      required: true
    },
    status: {
      type: String,
      enum: ["Available", "Busy", "Offline"],
      default: "Available"
    },
    address: {
      type: String
    },
    notes: {
      type: String
    },

    // Stats — من شاشة الـ tracking بتاع البيشنت اللي بتظهر اسم الرايدر وعدد deliveries وrating
    rating: {
      type: Number,
      default: 5.0,
      min: 0,
      max: 5
    },
    totalDeliveries: {
      type: Number,
      default: 0
    },

    // الأوردرات المكلف بيها دلوقتي
    assignedOrders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order"
      }
    ],

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("DeliveryMan", deliveryManSchema);