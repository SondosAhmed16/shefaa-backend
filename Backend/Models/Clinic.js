// models/Clinic.js
const mongoose = require("mongoose");

const breakSchema = new mongoose.Schema({
  start: { type: Number, required: true },
  end:   { type: Number, required: true },
  label: { type: String, default: "" },
}, { _id: false });

const dayScheduleSchema = new mongoose.Schema({
  day: {
    type: String,
    enum: ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"],
    required: true,
  },
  isActive:        { type: Boolean, default: true },
  open:            { type: Number, required: true },
  close:           { type: Number, required: true },
  breaks:          { type: [breakSchema], default: [] },
  slotDuration:    { type: Number, default: null },
  dailyCapacity:   { type: Number, default: null },
  patientsPerSlot: { type: Number, default: null },
  // ✅ انتقلوا هنا — على مستوى كل يوم
  isDayLocked:     { type: Boolean, default: false },
  isBookingLocked: { type: Boolean, default: false },
}, { _id: false });

const weeklyOverrideSchema = new mongoose.Schema({
  weekStart:       { type: Date, required: true },
  days:            { type: [dayScheduleSchema], default: [] }, // ✅ بيورث isDayLocked/isBookingLocked
  slotDuration:    { type: Number, default: null },
  dailyCapacity:   { type: Number, default: null },
  patientsPerSlot: { type: Number, default: null },
}, { _id: false });

const clinicSchema = new mongoose.Schema({
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true,
  },
  name:    { type: String, required: true, trim: true },
  city:    { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  location: {
    type:        { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
  },
  color: { type: String, default: "#1a56a0" },

  defaultSchedule: {
    days:            { type: [dayScheduleSchema], default: [] },
    slotDuration:    { type: Number, required: true, min: 5 },
    dailyCapacity:   { type: Number, required: true, min: 1 },
    patientsPerSlot: { type: Number, default: 1, min: 1 },
  },

  weeklyOverrides: { type: [weeklyOverrideSchema], default: [] },
  price:           { type: Number, required: true },
  operatingLicense: { type: String, default: "" },

  status: {
    type: String,
    enum: ["pending", "active", "rejected"],
    default: "pending",
  },
  activatedAt:     { type: Date, default: null },
  activatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectionReason: { type: String, default: "" },

}, { timestamps: true });

clinicSchema.index({ location: "2dsphere" });
clinicSchema.index({ doctorId: 1 });
clinicSchema.index({ _id: 1, "weeklyOverrides.weekStart": 1 });

clinicSchema.methods.resolveWeek = function (weekStart) {
  const override = this.weeklyOverrides.find(
    o => o.weekStart.toISOString() === new Date(weekStart).toISOString()
  );
  const defaults = this.defaultSchedule;

  if (!override) return {
    days:            defaults.days,
    slotDuration:    defaults.slotDuration,
    dailyCapacity:   defaults.dailyCapacity,
    patientsPerSlot: defaults.patientsPerSlot,
  };

  const mergedDays = defaults.days.map(defDay => {
    const ovDay = override.days.find(d => d.day === defDay.day);
    // ✅ override بيكسب على كل field حتى isDayLocked/isBookingLocked
    return ovDay ? { ...defDay.toObject(), ...ovDay.toObject() } : defDay;
  });

  return {
    days:            mergedDays,
    slotDuration:    override.slotDuration    ?? defaults.slotDuration,
    dailyCapacity:   override.dailyCapacity   ?? defaults.dailyCapacity,
    patientsPerSlot: override.patientsPerSlot ?? defaults.patientsPerSlot,
  };
};

// ✅ كده لو الموديل اتعمل قبل كده، بياخده بدل ما يعمله تاني
module.exports = mongoose.models.Clinic || mongoose.model("Clinic", clinicSchema);