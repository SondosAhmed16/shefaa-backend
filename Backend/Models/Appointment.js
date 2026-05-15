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

    prescription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
      default: null,
    },

    date: {
      type: Date,
      required: true,
    },

    timeChosed: {
      type: String,
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
      enum: ["pending", "paid-at-clinic", "paid-online", "cancelled"],
      default: "pending",
    },

    paymentOption: {
      type: String,
      enum: ["atClinic", "prePay"],
      required: true,
    },
    status: {
      type: String,
      enum: ["available", "upcoming", "inProgress", "cancelled", "completed", "no-show"],
      default: "upcoming",
    }, 
    paidAt: {
      type: Date,
      default: null,
    },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
