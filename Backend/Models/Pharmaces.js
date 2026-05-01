const mongoose = require("mongoose");

const pharmacySchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      unique: true 
    },
    
    pharmacyName: { 
      type: String, 
      required: true 
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

    rating: { 
      type: Number, 
      default: 4.8 
    }, 
workingHours: [
      {
        days: { type: String, required: true }, 
        time: { type: String, required: true }  
      }
    ],
    phone: { 
      type: String 
    },
    about: { 
      type: String 
    },

    deliveryAvailable: { 
      type: Boolean, 
      default: true 
    },
    openNow: { 
      type: Boolean, 
      default: true 
    },
    prescriptionOnly: { 
      type: Boolean, 
      default: false 
    },

    addresses: [
      {
        addressText: { type: String, required: true },
        location: {
          type: { type: String, enum: ["Point"], default: "Point" },
          coordinates: { type: [Number], required: true }, 
        },
      },
    ],
  },
  { timestamps: true }
);

pharmacySchema.index({ "addresses.location": "2dsphere" });

module.exports = mongoose.model("Pharmacy", pharmacySchema);