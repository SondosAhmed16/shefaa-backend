const mongoose = require("mongoose");

const pharmacySchema = new mongoose.Schema(
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
      trim: true
    },

    medicalLicencePdf: {
      type: String
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
  },
  { timestamps: true }
);

pharmacySchema.index({ "addresses.location": "2dsphere" });

module.exports = mongoose.model("Pharmacy", pharmacySchema);