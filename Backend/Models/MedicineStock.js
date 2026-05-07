const mongoose = require("mongoose");

const medicineStockSchema = new mongoose.Schema(
  {
    pharmacyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pharmacy", required: true
    },
    medicineName: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      default: 0
    },
    price: {
      type: Number,
      required: true
    },
    minThreshold: {
      type: Number,
      default: 5
    },
    category: {
      type: String,
      required: true
    },
    requiresPrescription: {
      type: Boolean,
      default: false
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicineStock", medicineStockSchema);