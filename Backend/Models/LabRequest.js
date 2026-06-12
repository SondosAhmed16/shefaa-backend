const mongoose = require("mongoose");

const labRequestSchema = new mongoose.Schema(
  {
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lab",
      required: true,
    },

    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patients", 
      required: true,
    },
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Service",
      }
    ],
    viaAI: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true } 
);

module.exports = mongoose.model("LabRequest", labRequestSchema);