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
      addressText: String,
      location: {
        type: { type: String, default: "Point" },
        coordinates: [Number] // [longitude, latitude]
      }
    },
    age: { type: Number, default: 1, min: 1, max: 120 },
    gender: { type: String, enum: ["male", "female", ""], default: "" },
    medications: [{
      name: String,
      dosage: String,
      form: { type: String, enum: ["Tablet", "Capsule", "Syrup", "Injection"] },
      timesPerDay: Number,
      schedule: [String],
      startDate: { type: Date },
      endDate: { type: Date },
      isActive: { type: Boolean, default: true },
      adherenceHistory: [{
        date: { type: Date, default: Date.now },
        status: { type: String, enum: ["taken", "missed"], default: "taken" }
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
    chronicConditions: { type: [String], default: "None" },

    // --- Block system ---
    isBlocked: { type: Boolean, default: false },
    blockedUntil: { type: Date, default: null },
    blockReason: { type: String, default: null },
  },
  { timestamps: true }
);

// Auto-lift expired blocks on read
patientSchema.methods.checkAndLiftBlock = async function () {
  if (this.isBlocked && this.blockedUntil && new Date() > this.blockedUntil) {
    this.isBlocked = false;
    this.blockedUntil = null;
    this.blockReason = null;
    await this.save();
  }
};

module.exports = mongoose.model("Patient", patientSchema);