const mongoose = require('mongoose');

/**
 * PlatformSettings Model
 *
 * Singleton document — there should only ever be ONE document in this collection.
 * Use findOne() / findOneAndUpdate({ }, ..., { upsert: true }) everywhere.
 */
const platformSettingsSchema = new mongoose.Schema(
  {
    // ── Feature flags ─────────────────────────────────────────────────────────
    maintenance: {
      type: Boolean,
      default: false,
      comment: 'When true the API should return 503 for non-admin requests',
    },
    registrations: {
      type: Boolean,
      default: true,
      comment: 'Allow new user sign-ups',
    },
    email: {
      type: Boolean,
      default: true,
      comment: 'Send system emails (activation, reminders, etc.)',
    },
    sms: {
      type: Boolean,
      default: true,
      comment: 'Send SMS alerts for bookings and reminders',
    },
    ai: {
      type: Boolean,
      default: true,
      comment: 'Enable AI-powered pharmacy & lab recommendations',
    },

    // ── Verification requirements ─────────────────────────────────────────────
    docLicense: {
      type: Boolean,
      default: true,
      comment: 'Require doctors to upload a license before activation',
    },
    pharmaLicense: {
      type: Boolean,
      default: true,
      comment: 'Require pharmacies to upload a license before activation',
    },
    patientId: {
      type: Boolean,
      default: false,
      comment: 'Require patients to verify a national ID',
    },
    twoFa: {
      type: Boolean,
      default: true,
      comment: 'Enforce 2-FA for doctor accounts',
    },
  },
  {
    timestamps: true,
    collection: 'platformsettings', // explicit collection name
  }
);

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);