const mongoose = require("mongoose");

const labSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    commercialRegisterNumber: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true
    },

    medicalLicencePdf: {
      type: String
    },
    facilityType: {
      type: String,
      enum: ["lab", "radiology center"],
      required: true
    },
    medicalDirectorName: {
      type: String,
      required: true
    },
    directorProfessionalId: {
      type: String,
      required: true
    },

    addresses: [
      {
        addressText: { type: String, required: false, trim: true },
        location: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: {
            type: [Number],
            required: true,
          },
        },
      },
    ],
    tests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LabTest",
      },
    ],
  },
  { timestamps: true }
);

labSchema.index({ "addresses.location": "2dsphere" });

module.exports = mongoose.model("Lab", labSchema);