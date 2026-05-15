const mongoose = require('mongoose');

const billingRecordSchema = new mongoose.Schema(
  {
    entity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    entityProfile: {
      type: mongoose.Schema.Types.ObjectId,
      // points to Doctor, Pharmacy, or Lab document
      refPath: 'entityProfileModel',
    },
    entityProfileModel: {
      type: String,
      enum: ['Doctor', 'Pharmacy', 'Lab'],
    },
    entityType: {
      type: String,
      enum: ['doctor', 'pharmacy', 'lab'],
      required: true,
    },

    month: { type: Number, required: true, min: 1, max: 12 },
    year:  { type: Number, required: true },

    // Revenue they generated this month
    totalRevenue: { type: Number, default: 0 },

    // Doctor: number of appointments | Pharmacy: number of orders
    activityCount: { type: Number, default: 0 },

    // Platform commission rate: 0.015 for doctors, 0.01 for pharmacies
    rate: { type: Number, required: true },

    // totalRevenue * rate
    dueAmount: { type: Number, required: true, default: 0 },

    paid:      { type: Boolean, default: false },
    paidAt:    { type: Date,    default: null  },
    suspended: { type: Boolean, default: false },

    note: { type: String, default: '' },
  },
  { timestamps: true }
);

// One record per entity per month/year
billingRecordSchema.index(
  { entity: 1, month: 1, year: 1 },
  { unique: true }
);

module.exports = mongoose.model('BillingRecord', billingRecordSchema);