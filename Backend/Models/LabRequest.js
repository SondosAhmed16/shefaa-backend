const mongoose = require("mongoose");

const labRequestSchema = new mongoose.Schema(
  {
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lab",
      required: true,
    },

    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patients",
      required: true,
    },
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Service",
      }
    ],
    viaAI: {
      type: Boolean,
      default: false
    }
  ,
  status: {
  type: String,
  enum: ["pending", "completed"],
  default: "pending"
},
  resultFile: {
  type: String, 
  default: null
},
  resultFileType: {
  type: String,
  enum: ["image", "pdf", null],
  default: null
},
  resultUploadedAt: {
  type: Date,
  default: null
}
  },
{ timestamps: true } 

);

module.exports = mongoose.model("LabRequest", labRequestSchema);