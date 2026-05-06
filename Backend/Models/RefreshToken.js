const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },
    deviceInfo: { type: String, default: "Unknown device" }, // e.g. "Chrome · Windows 11"
    ipAddress: { type: String, default: "" },
    location: { type: String, default: "" },               // e.g. "Cairo, Egypt"
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
