const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
        type: String,
        enum: ["New", "Preparing", "Ready", "Completed", "Cancelled"],
        default: "New"
    },
    items: [{
        medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "MedicineStock" },
        quantity: Number,
        price: Number
    }],
    totalPrice: Number
}, { timestamps: true });

module.exports = mongoose.model("Order", orderSchema);