const mongoose = require("mongoose");
const medicationSchema = require("./Medication");

const prescriptionSchema = new mongoose.Schema(
  {
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    // ── NEW: Diagnosis ──────────────────────────────
    diagnosis: {
      type: String,
      default: "",
      trim: true,
    },

    medicines: {
      type: [medicationSchema],
      default: [],
    },

    // ── NEW: Lab Tests ──────────────────────────────
    labTests: [
      {
        type: String,
        trim: true,
      },
    ],

    // ── NEW: Imaging / Radiology ────────────────────
    imaging: [
      {
        type: String,
        trim: true,
      },
    ],

    // ── NEW: Next Visit ─────────────────────────────
    nextVisit: {
      type: String,   // e.g. "2 weeks", "1 month"
      default: "",
      trim: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    attachedFiles: [
      new mongoose.Schema(
        {
          fileName: String,
          fileUrl: String,
          uploadedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],

    suggestedPharmacies: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Pharmacy",
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prescription", prescriptionSchema);