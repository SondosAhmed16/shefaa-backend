const mongoose = require("mongoose");
const labTestSchema = new mongoose.Schema(
  {
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lab",
      required: true,
    },

    testName: {
      type: String,
      required: true,
      trim: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    estimatedTime: {
      type: String,
      required: true, 
    },
  },
  { timestamps: true }
);

module.exports= mongoose.model("LabTest", labTestSchema);
