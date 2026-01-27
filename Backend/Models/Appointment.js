const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },

    slotStart: {
      type: String, 
      required: true,
    },

    slotEnd: {
      type: String, 
      required: true,
    },

    isFollowUp: {
      type: Boolean,
      default: false,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "rejected", "refunded"],
      default: "pending",
    },

    paymentOption: {
      type: String,
      enum: ["atClinic", "prePay"],
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["booked", "cancelled", "completed"],
      default: "booked",
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    files: [
      {
        fileName: String,
        fileUrl: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

module.exports= mongoose.model("Appointment", appointmentSchema);
