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

    liveLocation: {
      latitude: { type: Number, required: false },
      longitude: { type: Number, required: false }
    },

    medicalHistory: {
      type: String,
      default: "",
    },

    familyMedicalHistory: {
      type: String,
      default: "",
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
      type: [String], // مثال: ["Penicillin", "Dust", "Peanuts"]
      default: [],
    },
  },

  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Patient", patientSchema);

