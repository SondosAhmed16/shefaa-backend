const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lab",
      required: true,
    },
    name: {
      type: String, 
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["test", "scan"],
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    estimatedTime: {
      type: String, 
      required: true,
    },
    instructions: {
      type: String, 
      default: "",
    },
    sessionDuration: {
      type: String,
      default: "",
    },
    imageUrl: {
      type: String, 
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true, 
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);