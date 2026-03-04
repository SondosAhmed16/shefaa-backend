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

    preOnlineConsultation: {
      type: Boolean,
      default: false,
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

    videoConsultationPrice: { type: Number, default: 0 },
    clinicConsultationPrice: { type: Number, default: 0 },

    reviews: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Review",
      },
    ],
  },

  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Doctor", doctorSchema);

