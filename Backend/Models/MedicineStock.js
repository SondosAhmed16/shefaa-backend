const mongoose = require("mongoose");

const medicineStockSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true
    },

    medicineName: {
      type: String,
      required: true,
      trim: true
    },
    genericName: {
      type: String,
      trim: true
    },
    concentration: {
      type: String,
      trim: true,
      default: "N/A"
    },
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: [
        "analgesic",
        "antibiotic",
        "antiviral",
        "antidiabetic",
        "cardiac",
        "diabetes",
        "allergy",
        "vitamins",
        "antihistamine",
        "antifungal",
        "antiseptic",
        "respiratory",
        "gastrointestinal",
        "dermatology",
        "supplements",
        "other"
      ]
    },
    dosageForm: {
      type: String,
      enum: ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Drops", "Other"]
    },
    manufacturer: {
      type: String
    },
    barcode: {
      type: String,
      trim: true
    },

    price: {
      type: Number,
      required: true
    },
    quantity: {
      type: Number,
      default: 0
    },
    minThreshold: {
      type: Number,
      default: 5             // لو quantity وصل لده بيظهر Low Stock Alert
    },

    // inStock منفصل عشان الصيدلي يقدر يخليه invisible حتى لو عنده stock
    inStock: {
      type: Boolean,
      default: true
    },

    requiresPrescription: {
      type: Boolean,
      default: false
    },

    expiryDate: {
      type: Date
    },

    // تفاصيل طبية — بتظهر في Med Detail screen عند البيشنت وفي Edit Modal في الداشبورد
    indications: {
      type: String         // "Used for type 2 diabetes…"
    },
    sideEffects: {
      type: String
    },
    dosageInstructions: {
      type: String
    },
    notes: {
      type: String         // storage conditions, warnings…
    },

    image: {
      type: String         // URL
    }
  },
  { timestamps: true }
);

// بحث نصي سريع من شاشة البيشنت
medicineStockSchema.index(
  { medicineName: "text", genericName: "text", category: "text" }
);

module.exports = mongoose.model("MedicineStock", medicineStockSchema);