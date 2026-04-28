const mongoose = require("mongoose");

// ─── Reusable sub-schemas ───────────────────────────────────────────────────

const breakSchema = new mongoose.Schema({
  start: { type: Number, required: true }, // minutes from midnight
  end: { type: Number, required: true },
  label: { type: String, default: "" },
}, { _id: false });

const dayScheduleSchema = new mongoose.Schema({
  day: {
    type: String,
    enum: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    required: true,
  },
  isActive: { type: Boolean, default: true },   // false = clinic closed this day
  open: { type: Number, required: true },  // mins e.g. 480 = 08:00
  close: { type: Number, required: true },  // mins e.g. 840 = 14:00
  breaks: { type: [breakSchema], default: [] },
  slotDuration: { type: Number, default: null },   // override per-day if needed
  dailyCapacity: { type: Number, default: null },   // override per-day if needed
  patientsPerSlot: { type: Number, default: null },
}, { _id: false });

// ─── Weekly override ────────────────────────────────────────────────────────
// One document per ISO week that has any change.
// weekStart = Monday 00:00:00 UTC of that week (use as unique key).

const weeklyOverrideSchema = new mongoose.Schema({
  weekStart: { type: Date, required: true },  // Monday of the target week

  // Only days that differ from default need to be listed.
  // If a day is missing here → use defaultSchedule for that day.
  days: { type: [dayScheduleSchema], default: [] },

  // Clinic-level overrides for the whole week
  slotDuration: { type: Number, default: null },
  dailyCapacity: { type: Number, default: null },
  patientsPerSlot: { type: Number, default: null },

  isDayLocked: { type: Boolean, default: false }, // "Lock day" button in ClinicManagement
}, { _id: false });

// ─── Main clinic schema ─────────────────────────────────────────────────────

const clinicSchema = new mongoose.Schema({
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true,
  },

  name: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },

  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },

  color: { type: String, default: "#1a56a0" },

  // ─── DEFAULT schedule (set from ClinicInfo page) ──────────────────────────
  defaultSchedule: {
    days: { type: [dayScheduleSchema], default: [] },
    slotDuration: { type: Number, required: true, min: 5 },
    dailyCapacity: { type: Number, required: true, min: 1 },
    patientsPerSlot: { type: Number, default: 1, min: 1 },
  },

  // ─── Per-week overrides (set from ClinicManagement page) ─────────────────
  // Max ~52 entries/year; old ones can be pruned by a cron job.
  weeklyOverrides: { type: [weeklyOverrideSchema], default: [] },

  price: { type: Number, required: true },

  // ─── Licenses ─────────────────────────────────────────────────────────────
  operatingLicense: { type: String, default: "" },

  // ─── Status ───────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ["pending", "active", "rejected"],
    default: "pending",
  },
  activatedAt: { type: Date, default: null },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectionReason: { type: String, default: "" },

}, { timestamps: true });

// ─── Indexes ────────────────────────────────────────────────────────────────
clinicSchema.index({ location: "2dsphere" });
clinicSchema.index({ doctorId: 1 });
// Fast lookup of overrides by week
clinicSchema.index({ _id: 1, "weeklyOverrides.weekStart": 1 });

// ─── Helper: resolve effective schedule for a given ISO week ────────────────
// Returns the merged schedule (override on top of default).
// Call as:  clinic.resolveWeek(weekStartDate)
clinicSchema.methods.resolveWeek = function (weekStart) {
  const override = this.weeklyOverrides.find(
    o => o.weekStart.toISOString() === new Date(weekStart).toISOString()
  );

  const defaults = this.defaultSchedule;

  if (!override) return {
    days: defaults.days,
    slotDuration: defaults.slotDuration,
    dailyCapacity: defaults.dailyCapacity,
    patientsPerSlot: defaults.patientsPerSlot,
    isDayLocked: false,
  };

  // Merge day-level: override days win; missing days fall back to default
  const mergedDays = defaults.days.map(defDay => {
    const ovDay = override.days.find(d => d.day === defDay.day);
    return ovDay ? { ...defDay.toObject(), ...ovDay.toObject() } : defDay;
  });

  return {
    days: mergedDays,
    slotDuration: override.slotDuration ?? defaults.slotDuration,
    dailyCapacity: override.dailyCapacity ?? defaults.dailyCapacity,
    patientsPerSlot: override.patientsPerSlot ?? defaults.patientsPerSlot,
    isDayLocked: override.isDayLocked,
  };
};

module.exports = mongoose.model("Clinic", clinicSchema);