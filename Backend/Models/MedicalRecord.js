const mongoose = require("mongoose");
const medicationSchema = require("./Medication"); // CommonJS

const medicalRecordSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: false,
    },

    diagnosis: {
      type: String,
      required: true,
      trim: true,
    },

    prescription: {
      type: [medicationSchema], 
      default: [],
    },

    visitDate: {
      type: Date,
      required: true,
    },

    nextVisitDate: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    attachments: [
      new mongoose.Schema(
        {
          fileName: String,
          fileUrl: String,
          uploadedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicalRecord", medicalRecordSchema);
