const mongoose = require("mongoose");
const medicationSchema = require("./Medication"); // CommonJS

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

    medicines: {
      type: [medicationSchema], 
      default: [],
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
