// controllers/appointmentController.js
const mongoose = require("mongoose");
const Appointment = require("../Models/Appointment");
const Clinic = require("../Models/Clinic");
const Doctor = require("../Models/Doctors");
const Patient = require("../Models/Patients");
const Notification = require("../Models/Notification");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const timeToMins = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const minsToTime = (mins) => {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
};

const buildDaySlots = (open, close, breaks = [], slotDuration) => {
  const slots = [];
  const sortedBreaks = [...breaks].sort((a, b) => a.start - b.start);
  const windows = [];
  let cursor = open;
  for (const br of sortedBreaks) {
    if (br.start > cursor) windows.push({ from: cursor, to: br.start });
    cursor = br.end;
  }
  if (cursor < close) windows.push({ from: cursor, to: close });
  for (const win of windows) {
    let t = win.from;
    while (t + slotDuration <= win.to) {
      slots.push({ start: t, end: t + slotDuration });
      t += slotDuration;
    }
  }
  return slots;
};

// Same safe date comparison used in getAvailableSlots
const isSameUTCDate = (a, b) => {
  const da = new Date(a), db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth()    === db.getUTCMonth()    &&
    da.getUTCDate()     === db.getUTCDate()
  );
};

// Resolve the correct override for a given date (matches getAvailableSlots logic)
const resolveScheduleForDate = (clinic, requestedDate) => {
  const DAY_ORDER = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const requestedDayName = DAY_ORDER[requestedDate.getUTCDay()];

  // Find week start (Saturday)
  const daysSinceSaturday = (requestedDate.getUTCDay() + 1) % 7;
  const weekStartDate = new Date(requestedDate);
  weekStartDate.setUTCDate(requestedDate.getUTCDate() - daysSinceSaturday);

  // Safe date comparison — avoids the ISO string timezone bug
  const override = clinic.weeklyOverrides?.find((o) =>
    isSameUTCDate(o.weekStart, weekStartDate)
  );

  const defaults = clinic.defaultSchedule;

  const mergedDays = (defaults.days || []).map((defDay) => {
    const ovDay = override?.days?.find((d) => d.day === defDay.day);
    return ovDay ? { ...defDay.toObject?.() ?? defDay, ...ovDay.toObject?.() ?? ovDay } : (defDay.toObject?.() ?? defDay);
  });
  for (const ovDay of override?.days || []) {
    if (!mergedDays.some((d) => d.day === ovDay.day))
      mergedDays.push(ovDay.toObject?.() ?? ovDay);
  }

  return {
    requestedDayName,
    mergedDays,
    resolvedSlotDuration:    override?.slotDuration    ?? defaults.slotDuration,
    resolvedDailyCapacity:   override?.dailyCapacity   ?? defaults.dailyCapacity,
    resolvedPatientsPerSlot: override?.patientsPerSlot ?? defaults.patientsPerSlot,
  };
};

// ─── Book Appointment ─────────────────────────────────────────────────────────

exports.bookAppointment = async (req, res) => {
  try {
    const {
      clinicId,
      date,
      timeChosed,
      isFollowUp,
      paymentStatus,
      paymentOption,
    } = req.body;

    // ── 1. Validation ─────────────────────────────
    if (!clinicId || !date || !timeChosed || !paymentOption) {
      return res.status(400).json({
        message: "clinicId, date, timeChosed, and paymentOption are required.",
      });
    }

    // ── 2. Load clinic ────────────────────────────
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });

    // ── 3. Load patient ───────────────────────────
    const patientProfile = await Patient.findOne({ userId: req.user._id });
    if (!patientProfile)
      return res.status(404).json({ message: "Patient profile not found." });

    // ── 4. Parse date ─────────────────────────────
    const requestedDate = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ message: "Invalid date format." });
    }

    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    if (requestedDate < todayUTC) {
      return res.status(400).json({ message: "Cannot book in the past." });
    }

    // ── 5. Resolve schedule ───────────────────────
    const {
      requestedDayName,
      mergedDays,
      resolvedSlotDuration,
      resolvedDailyCapacity,
      resolvedPatientsPerSlot,
    } = resolveScheduleForDate(clinic, requestedDate);

    const dayEntry = mergedDays.find((d) => d.day === requestedDayName);

    if (!dayEntry)
      return res.status(400).json({ message: `Doctor does not work on ${requestedDayName}.` });

    if (!dayEntry.isActive)
      return res.status(400).json({ message: "This day is inactive." });

    if (dayEntry.isDayLocked)
      return res.status(400).json({ message: "Day is locked." });

    if (dayEntry.isBookingLocked)
      return res.status(400).json({ message: "Booking is locked." });

    // ── 6. Resolve values ─────────────────────────
    const slotDuration = dayEntry.slotDuration ?? resolvedSlotDuration;
    const dailyCapacity = dayEntry.dailyCapacity ?? resolvedDailyCapacity;
    const patientsPerSlot = dayEntry.patientsPerSlot ?? resolvedPatientsPerSlot;

    // ── 7. Validate slot (using timeChosed) ───────
    const validSlots = buildDaySlots(
      dayEntry.open,
      dayEntry.close,
      dayEntry.breaks,
      slotDuration
    );

    const matchedSlot = validSlots.find(
      (s) => minsToTime(s.start) === timeChosed
    );

    if (!matchedSlot) {
      return res.status(400).json({
        message: `"${timeChosed}" is not a valid slot.`,
      });
    }

    const slotStart = minsToTime(matchedSlot.start);
    const slotEnd = minsToTime(matchedSlot.end);

    // ── 8. Prevent past slot today ────────────────
    const isToday = requestedDate.getTime() === todayUTC.getTime();
    if (isToday) {
      const nowMins =
        new Date().getUTCHours() * 60 + new Date().getUTCMinutes();

      if (matchedSlot.end <= nowMins) {
        return res.status(400).json({ message: "Slot already passed." });
      }
    }

    // ── 9. Capacity checks ────────────────────────
    const OCCUPYING_STATUSES = ["upcoming", "inProgress", "completed"];

    const [slotCount, dayCount] = await Promise.all([
      Appointment.countDocuments({
        clinic: clinic._id,
        date: requestedDate,
        slotStart,
        status: { $in: OCCUPYING_STATUSES },
      }),
      Appointment.countDocuments({
        clinic: clinic._id,
        date: requestedDate,
        status: { $in: OCCUPYING_STATUSES },
      }),
    ]);

    if (slotCount >= patientsPerSlot) {
      return res.status(409).json({ message: "Slot is full." });
    }

    if (dayCount >= dailyCapacity) {
      return res.status(409).json({ message: "Day is full." });
    }

    // ── 10. Prevent duplicate ─────────────────────
    const alreadyBooked = await Appointment.findOne({
      clinic: clinic._id,
      patient: patientProfile._id,
      date: requestedDate,
      status: { $in: OCCUPYING_STATUSES },
    });

    if (alreadyBooked) {
      return res.status(409).json({
        message: "You already have an appointment this day.",
      });
    }

    // ── 11. Create appointment ────────────────────
    const appointment = await Appointment.create({
      patient: patientProfile._id,
      doctor: clinic.doctorId,
      clinic: clinic._id,
      date: requestedDate,

      // 👇 الجديد
      timeChosed,

      // 👇 محسوبين داخليًا
      slotStart,
      slotEnd,

      isFollowUp: isFollowUp ?? false,
      paymentOption,
      paymentStatus: paymentStatus || "pending",

      status: "upcoming",
    });

    // ── 12. Notification ─────────────────────────
    await Notification.create({
      recipient: req.user.id,
      title: "Appointment Booked",
      message: `Your appointment at ${clinic.name} on ${date} at ${timeChosed} has been confirmed.`,
      type: "appointment",
    });

    return res.status(201).json({
      message: "Appointment booked successfully.",
      appointment,
    });

  } catch (err) {
    console.error("bookAppointment error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── Get Appointments ─────────────────────────────────────────────────────────

exports.getAppointments = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === "doctor") {
      const doctorProfile = await Doctor.findOne({ userId: req.user.id });
      if (!doctorProfile) return res.status(404).json({ message: "Doctor profile not found." });
      filter.doctor = doctorProfile._id;
    } else if (req.user.role === "patient") {
      const patientProfile = await Patient.findOne({ userId: req.user.id });
      if (!patientProfile) return res.status(404).json({ message: "Patient profile not found." });
      filter.patient = patientProfile._id;
    } 

    const appointments = await Appointment.find(filter)
      .populate({ path: "patient", select: "userId", populate: { path: "userId", select: "name" } })
      .populate({ path: "doctor",  select: "userId", populate: { path: "userId", select: "name" } })
      .populate("clinic", "name address city price")
      .sort({ date: 1, slotStart: 1 });

    return res.status(200).json({ appointments });

  } catch (err) {
    console.error("getAppointments error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── Cancel Appointment ───────────────────────────────────────────────────────

exports.cancelAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });

    const patientProfile = await Patient.findOne({ userId: req.user.id });
    if (!patientProfile) return res.status(404).json({ message: "Patient profile not found." });

    // Only the patient who booked it (or an admin) can cancel
    const isOwner = appointment.patient.toString() === patientProfile._id.toString();
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to cancel this appointment." });
    }

    // Can't cancel what's already done
    if (["cancelled", "completed"].includes(appointment.status)) {
      return res.status(400).json({ message: `Appointment is already ${appointment.status}.` });
    }

    appointment.status = "cancelled";
    await appointment.save();

    await Notification.create({
      recipient: req.user.id,
      title:     "Appointment Cancelled",
      message:   `Your appointment on ${appointment.date.toISOString().split("T")[0]} at ${appointment.slotStart} has been cancelled.`,
      type:      "appointment",
    });

    return res.status(200).json({ message: "Appointment cancelled successfully." });

  } catch (err) {
    console.error("cancelAppointment error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── Send Reminders (Cron Job) ────────────────────────────────────────────────

exports.sendReminders = async () => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const appointments = await Appointment.find({
      date:   { $gte: todayStart, $lte: todayEnd },
      status: "upcoming",
    }).populate({
      path: "patient",
      populate: { path: "userId", select: "email name" },
    });

    for (const app of appointments) {
      await Notification.create({
        recipient: app.patient.userId._id,
        title:     "Appointment Reminder",
        message:   `Reminder: You have an appointment today at ${app.slotStart}.`,
        type:      "appointment",
      });
    }
  } catch (err) {
    console.error("sendReminders error:", err);
  }
};