const mongoose = require("mongoose");

const labSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    centerName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    facilityType: {
      type: String,
      enum: ["lab", "radiology center", "both"], 
      required: true
    },
    workingHours: {
      type: String,
      required: false
    },
    
    homeSampleCollection: {
      type: Boolean,
      default: false
    },
    aiRecommendations: {
      type: Boolean,
      default: true
    },
    insuranceAccepted: {
      type: Boolean,
      default: false
    },
    
    paymentMethods: [
      {
        type: String,
        enum: ["Cash", "Visa", "Insurance"],
        default: ["Cash"]
      }
    ],
    rating: {
      type: Number,
      default: 4.5,
      min: 0,
      max: 5
    },
    
    commercialRegisterNumber: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true
    },

    licenseValidUntil: {
      type: Date 
    },
    medicalLicencePdf: {
      type: String
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
        addressText: { type: String, required: true, trim: true }, 
        floor: { type: Number }, 
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