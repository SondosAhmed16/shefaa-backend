const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    address: {
      type: String,
      default: "",
    },
    age: {
      type: Number,
      default: 1,
      min: 1,
      max: 120,
    },
    gender: {
      type: String,
      enum: ["male", "female", ""],
      default: "",
    },
    // to add medication 
    medications: [{
      name: String,
      dosage: String,
      form: { type: String, enum: ["Tablet", "Capsule", "Syrup", "Injection"] },
      timesPerDay: Number,
      schedule: [String],
      isActive: { type: Boolean, default: true },
      adherenceHistory: [{
        date: { type: Date, default: Date.now },
        status: { type: String, enum: ['taken', 'missed'], default: 'taken' }
      }]
    }],
    height: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    bloodType: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", ""],
      default: "",
    },
    allergies: { type: [String], default: "None" },
    chronicConditions: {
      type: [String], default: "None",
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Patient", patientSchema);