const mongoose = require("mongoose");
const doctorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    specialization: {
      type: String,
      required: true,
      trim: true,
    },

    age: {
      type: Number,
      required: false,
      min: 24,
      max: 100,
    },

    yearsOfExperience: {
      type: Number,
      required: false,
      min: 0,
    },
    contactNumber: {
      type: String,
      required: false, // خليها false عشان الداتا القديمة
      default: "",
    },

    image: {
      type: String,
      default: "",
    },

    about: {
      type: String,
      default: "",
    },
    membershipPdf: {
      type: String,
      required: true,
      default: "",
    },

    degrees: {
      type: [String],
      default: [],
    },
    clinics: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Clinic",
      },
    ],

    paymentOption: {
      type: String,
      enum: ["in_clinic", "pre_payment", "both"],
      required: false,
      default: "in_clinic",
    },

    prePaymentNumbers: {
      type: [String],
      default: [],
    },

    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },


    gender: {
      type: String,
      enum: ["male", "female"],
      required: false,
    },
    clinicConsultationPrice: { type: Number, default: 0 },

    reviews: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Review",
      },
    ],
    visibilityStatus: {
      type: String,
      enum: ["active", "hidden", "suspended"],
      default: "active",
    },
    hiddenAt: {
      type: Date,
      default: null,
    },
    hiddenReason: {
      type: String,
      default: null,
    },
  },

  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Doctor || mongoose.model("Doctor", doctorSchema);

