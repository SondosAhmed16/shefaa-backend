const mongoose = require("mongoose");

const medicationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    dosage: {
      type: String,
      required: true,
    },

    frequency: {
      type: String,
      required: true,
    },

    duration: {
      type: String,
      required: true,
    },

    instructions: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false } 
);

module.exports = medicationSchema;
