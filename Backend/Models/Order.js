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
    ,
    orderNumber: { type: String, required: true }, // PHX-1082
    status: {
        type: String,
        enum: ["New", "Preparing", "Ready", "Shipped", "Completed"], 
        default: "New"
    },
    estimatedTime: { type: String }, 
    paymentMethod: {
        type: String,
        enum: ["Cash", "Credit Card"],
        default: "Cash"
    },
    paymentStatus: {
        type: String,
        enum: ["Pending", "Paid"],
        default: "Pending"
    },
    deliveryAddress: { type: String, required: true }
}
    , { timestamps: true });

module.exports = mongoose.model("Order", orderSchema);