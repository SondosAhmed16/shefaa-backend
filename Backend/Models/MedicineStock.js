const mongoose = require("mongoose");

const medicineStockSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy",
      required: true,
    },

    medicineName: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    expirationDate: {
      type: Date,
      required: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    category: {
      type: String,
      enum: [
        "Painkiller",
        "Antibiotic",
        "Vitamin",
        "Chronic",
        "Emergency",
        "Other",
      ],
      default: "Other",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicineStock", medicineStockSchema);
