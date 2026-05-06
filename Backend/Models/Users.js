const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true
    },

    role: {
      type: String,
      enum: ["doctor", "patient", "pharmacy", "lab", "admin"],
      default: "patient",
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    passwordChangedAt: {
      type: Date,
    },

    twoFA: {
      enabled: { type: Boolean, default: false },
      method: { type: String, enum: ["sms", "email"], default: "email" },
      otpHash: { type: String },
      otpExpires: { type: Date },
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
