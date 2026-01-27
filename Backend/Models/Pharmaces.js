const mongoose = require("mongoose");

const pharmacySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, 
     },

    licence: {
      type: String,
      required: true,
      trim: true,
    },

    registrationNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    commercialRegisterNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    addresses: [
      {
        addressText: { type: String, required: true, trim: true },
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
