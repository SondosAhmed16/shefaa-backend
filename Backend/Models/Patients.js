const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, 
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
    },
    // الحقول الجديدة (الطول والوزن)
    height: {
      type: Number,
      min: 30, // سم
      max: 250,
      default: 0
    },
    weight: {
      type: Number,
      min: 2, // كجم
      max: 500,
      default: 0
    },
    age: {
      type: Number,
      required: true,
      min: 0,
      max: 120,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: true,
    },
    bloodType: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", ""],
      default: "",
    },
    allergies: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Patient", patientSchema);