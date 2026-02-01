const mongoose = require("mongoose");
const clinicSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], 
        required: true,
      },
    },

    availableDays: [
      {
        type: String,
        enum: [
          "Saturday",
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
        ],
      },
    ],

    daysOfWeek: [
      {
        day: {
          type: String,
          enum: [
            "Saturday",
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
          ],
          required: true,
        },

        open: { type: String, required: true }, 
        close: { type: String, required: true }, 

        breaks: [
          {
            start: { type: String, required: true }, 
            end: { type: String, required: true },  
          },
        ],
      },
    ],

    dailyCapacity: {
      type: Number,
      required: true,
      min: 1,
    },

    slotDuration: {
      type: Number, 
      required: true,
      min: 5,
    },

    capacityPerSlot: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
  },

  { timestamps: true }
);

clinicSchema.index({ location: "2dsphere" });

module.exports= mongoose.model("Clinic", clinicSchema);
