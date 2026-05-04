// controllers/appointmentController.js
const mongoose = require("mongoose");
const Appointment = require("../Models/Appointment");
const Clinic = require("../Models/Clinic");
const Doctor = require("../Models/Doctors");
const Patient = require("../Models/Patients");
const Notification = require("../Models/Notification");
const Prescription = require("../Models/Prescription");
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
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
};

// Resolve the correct override for a given date (matches getAvailableSlots logic)
const resolveScheduleForDate = (clinic, requestedDate) => {
  const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
    resolvedSlotDuration: override?.slotDuration ?? defaults.slotDuration,
    resolvedDailyCapacity: override?.dailyCapacity ?? defaults.dailyCapacity,
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
    // ── 3. Load patient ───────────────────────────
    const patientProfile = await Patient.findOne({ userId: req.user._id });
    if (!patientProfile)
      return res.status(404).json({ message: "Patient profile not found." });

    // ── 3.5 Block check ───────────────────────────
    await patientProfile.checkAndLiftBlock();

    if (patientProfile.isBlocked) {
      return res.status(403).json({
        message: `You are blocked from booking appointments until ${patientProfile.blockedUntil.toDateString()}. Reason: ${patientProfile.blockReason}`,
      });
    }
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


// ─── Send Reminders (Cron Job) ────────────────────────────────────────────────

exports.sendReminders = async () => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const appointments = await Appointment.find({
      date: { $gte: todayStart, $lte: todayEnd },
      status: "upcoming",
    }).populate({
      path: "patient",
      populate: { path: "userId", select: "email name" },
    });

    for (const app of appointments) {
      await Notification.create({
        recipient: app.patient.userId._id,
        title: "Appointment Reminder",
        message: `Reminder: You have an appointment today at ${app.slotStart}.`,
        type: "appointment",
      });
    }
  } catch (err) {
    console.error("sendReminders error:", err);
  }
};


// Helper: check if appointment day has started
const hasAppointmentDayStarted = (appointmentDate) => {
  const now = new Date();
  const apptDay = new Date(appointmentDate);

  // Normalize both to midnight (start of day) for comparison
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const apptDayStart = new Date(
    apptDay.getFullYear(),
    apptDay.getMonth(),
    apptDay.getDate()
  );

  return apptDayStart <= todayStart;
};

// ─────────────────────────────────────────────
// GET /appointments/my
// Returns all appointments for the logged-in patient
// ─────────────────────────────────────────────
exports.getMyAppointments = async (req, res) => {
  try {
    let appointments;

    if (req.user.role === "patient") {
      const patientProfile = await Patient.findOne({ userId: req.user._id });
      if (!patientProfile)
        return res.status(404).json({ success: false, message: "Patient profile not found." });

      await patientProfile.checkAndLiftBlock();

      if (patientProfile.isBlocked) {
        return res.status(403).json({
          success: false,
          message: `Your account is blocked until ${patientProfile.blockedUntil.toDateString()}. Reason: ${patientProfile.blockReason}`,
        });
      }

      appointments = await Appointment.find({ patient: patientProfile._id })
        .populate({
          path: "patient",
          select: "userId address age gender height weight bloodType allergies chronicConditions isBlocked",
          populate: {
            path: "userId",
            model: "User",
            select: "name email phoneNumber",
          },
        })
        .populate("doctor", "name specialization")
        .populate("clinic", "name address")
        .populate("prescription")
        .sort({ date: -1 });

    } else if (req.user.role === "doctor") {
      const doctorProfile = await Doctor.findOne({ userId: req.user._id });
      if (!doctorProfile)
        return res.status(404).json({ success: false, message: "Doctor profile not found." });

      appointments = await Appointment.find({ doctor: doctorProfile._id })
        .populate({
          path: "patient",
          select: "userId address age gender height weight bloodType allergies chronicConditions isBlocked",
          populate: {
            path: "userId",
            model: "User",
            select: "name email phoneNumber",
          },
        })
        .populate("clinic", "name address")
        .populate("prescription")
        .sort({ date: -1 });

    } else {
      return res.status(403).json({ success: false, message: "Unauthorized role." });
    }

    return res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments,
    });

  } catch (error) {
    console.error("getMyAppointments error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching appointments." });
  }
};



exports.cancelAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID.",
      });
    }

    // ✅ get appointment
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
    }

    // ✅ authorization حسب الدور
    let isAuthorized = false;

    if (req.user.role === "patient") {
      const patientProfile = await Patient.findOne({ userId: req.user._id });

      if (!patientProfile) {
        return res.status(404).json({
          success: false,
          message: "Patient profile not found.",
        });
      }

      isAuthorized =
        appointment.patient.toString() === patientProfile._id.toString();
    }

    if (req.user.role === "doctor") {
      const doctorProfile = await Doctor.findOne({ userId: req.user._id });

      if (!doctorProfile) {
        return res.status(404).json({
          success: false,
          message: "Doctor profile not found.",
        });
      }

      isAuthorized =
        appointment.doctor.toString() === doctorProfile._id.toString();
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this appointment.",
      });
    }

    // ✅ validations على الحالة
    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Appointment is already cancelled.",
      });
    }

    if (appointment.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel a completed appointment.",
      });
    }

    // ✅ منع الإلغاء يوم المعاد
    if (hasAppointmentDayStarted(appointment.date)) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot cancel an appointment on or after its scheduled day.",
      });
    }

    // ✅ update
    appointment.status = "cancelled";

    // حسب السيستم بتاعك تقدري تغيري دي
    appointment.paymentStatus = "cancelled";

    await appointment.save();

    return res.status(200).json({
      success: true,
      message: "Appointment cancelled successfully.",
      data: appointment,
    });
  } catch (error) {
    console.error("cancelAppointment error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while cancelling appointment.",
    });
  }
};

exports.rescheduleAppointment = async (req, res) => {
  try {
    const patientProfile = await Patient.findOne({ userId: req.user._id });
    if (!patientProfile)
      return res.status(404).json({ success: false, message: "Patient profile not found." });

    const { id } = req.params;
    const { date, slotStart, slotEnd, timeChosed } = req.body;

    if (!date || !slotStart || !slotEnd)
      return res.status(400).json({ success: false, message: "New date, slotStart, and slotEnd are required." });

    const appointment = await Appointment.findById(id);

    if (!appointment)
      return res.status(404).json({ success: false, message: "Appointment not found." });

    if (appointment.patient.toString() !== patientProfile._id.toString())
      return res.status(403).json({ success: false, message: "You are not authorized to reschedule this appointment." });

    if (["cancelled", "completed"].includes(appointment.status))
      return res.status(400).json({ success: false, message: `Cannot reschedule a ${appointment.status} appointment.` });

    if (hasAppointmentDayStarted(appointment.date))
      return res.status(400).json({ success: false, message: "Cannot reschedule an appointment once its day has started." });

    const newDate = new Date(`${date}T00:00:00.000Z`);
    if (hasAppointmentDayStarted(newDate))
      return res.status(400).json({ success: false, message: "The new appointment date must be a future date." });

    appointment.date = newDate;
    appointment.slotStart = slotStart;
    appointment.slotEnd = slotEnd;
    if (timeChosed !== undefined) appointment.timeChosed = timeChosed;
    appointment.status = "upcoming";
    await appointment.save();

    return res.status(200).json({ success: true, message: "Appointment rescheduled successfully.", data: appointment });
  } catch (error) {
    console.error("rescheduleAppointment error:", error);
    return res.status(500).json({ success: false, message: "Server error while rescheduling appointment." });
  }
};

/**
 * POST /api/appointments/:appointmentId/block-patient
 * Doctor/admin marks a patient as no-show → blocks them for 5 days.
 * Automatically sets isBlocked, blockedUntil (+5 days), and blockReason.
 */
exports.blockPatientForNoShow = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    // Only doctors (or admins) may block
    if (!["doctor", "admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    // Guard: only past appointments that were not rescheduled/cancelled/completed
    const isPast = new Date(appointment.date) < new Date();
    const blockableStatuses = ["pending", "confirmed"]; // adjust to your status enum
    if (!isPast || !blockableStatuses.includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: "Can only block for past appointments with no prior cancellation or reschedule.",
      });
    }

    // Resolve the Patient profile (appointment.patient may be a User _id or a Patient _id)
    const patientProfile = await Patient.findById(appointment.patient);
    if (!patientProfile) {
      return res.status(404).json({ success: false, message: "Patient profile not found." });
    }

    const BLOCK_DAYS = 5;
    const blockedUntil = new Date();
    blockedUntil.setDate(blockedUntil.getDate() + BLOCK_DAYS);

    patientProfile.isBlocked = true;
    patientProfile.blockedUntil = blockedUntil;
    patientProfile.blockReason = `No-show for appointment on ${new Date(appointment.date).toDateString()} without prior cancellation or reschedule.`;
    await patientProfile.save();

    // Optionally mark the appointment itself
    appointment.status = "no-show";
    await appointment.save();

    return res.status(200).json({
      success: true,
      message: `Patient blocked until ${blockedUntil.toDateString()}.`,
      blockedUntil,
    });

  } catch (error) {
    console.error("blockPatientForNoShow error:", error);
    return res.status(500).json({ success: false, message: "Server error while blocking patient." });
  }
};

// controllers/appointmentController.js

/**
 * PATCH /api/appointments/:id/mark-paid
 * Doctor or admin marks an appointment's payment as paid.
 */
exports.markAppointmentAsPaid = async (req, res) => {
  try {
    const { id } = req.params;

    // ── 1. Validate ObjectId ──────────────────────
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID.",
      });
    }

    // ── 2. Role guard ─────────────────────────────
    if (!["doctor", "admin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only doctors or admins can mark payments.",
      });
    }

    // ── 3. Load appointment ───────────────────────
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
    }

    // ── 4. Ownership check (doctor must own this clinic) ──
    if (req.user.role === "doctor") {
      const doctorProfile = await Doctor.findOne({ userId: req.user._id });
      if (!doctorProfile) {
        return res.status(404).json({
          success: false,
          message: "Doctor profile not found.",
        });
      }

      if (appointment.doctor.toString() !== doctorProfile._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to update this appointment.",
        });
      }
    }

    // ── 5. Guard: don't re-pay or pay cancelled ───
    if (appointment.paymentStatus === "paid-at-clinic") {
      return res.status(400).json({
        success: false,
        message: "Appointment is already marked as paid.",
      });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cannot mark payment for a cancelled appointment.",
      });
    }

    // ── 6. Update ─────────────────────────────────
    appointment.paymentStatus = "paid-at-clinic";
    appointment.paidAt = new Date();       // optional audit field
    await appointment.save();

    // ── 7. Notify patient ─────────────────────────
    const patientProfile = await Patient.findById(appointment.patient)
      .populate("userId", "_id");

    if (patientProfile?.userId) {
      await Notification.create({
        recipient: patientProfile.userId._id,
        title: "Payment Confirmed",
        message: `Your payment for the appointment on ${appointment.date.toDateString()} has been marked as paid.`,
        type: "payment_confirmed", // ✅ matches the enum
      });
    }

    return res.status(200).json({
      success: true,
      message: "Appointment marked as paid successfully.",
      data: appointment,
    });

  } catch (error) {
    console.error("markAppointmentAsPaid error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating payment status.",
    });
  }
};



// ─── POST /api/prescriptions ──────────────────────────────────────────────────
// Doctor creates a prescription for an appointment
exports.createPrescription = async (req, res) => {
  try {
    const { appointment: appointmentId, diagnosis, medicines, labTests, imaging, nextVisit, notes } = req.body;

    // ── 1. Role guard ─────────────────────────────
    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Only doctors can create prescriptions." });
    }

    // ── 2. Load doctor profile ────────────────────
    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    // ── 3. Validate required fields ───────────────
    if (!appointmentId) {
      return res.status(400).json({ success: false, message: "appointment ID is required." });
    }

    // ── 4. Load appointment ───────────────────────
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    // ── 5. Ownership check ────────────────────────
    if (appointment.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to prescribe for this appointment." });
    }

    // ── 6. Prevent duplicate prescription ─────────
    if (appointment.prescription) {
      return res.status(409).json({ success: false, message: "A prescription already exists for this appointment. Use update instead." });
    }

    // ── 7. Create prescription ────────────────────
    const prescription = await Prescription.create({
      appointment: appointment._id,
      doctor:      doctorProfile._id,
      patient:     appointment.patient,
      diagnosis:   diagnosis   || "",
      medicines:   medicines   || [],
      labTests:    labTests    || [],
      imaging:     imaging     || [],
      nextVisit:   nextVisit   || "",
      notes:       notes       || "",
    });

    // ── 8. Link prescription → appointment ────────
    appointment.prescription = prescription._id;
    await appointment.save();

    // ── 9. Return populated prescription ──────────
    const populated = await Prescription.findById(prescription._id)
      .populate("doctor",      "name specialization")
      .populate("patient",     "userId age gender")
      .populate("appointment", "date slotStart slotEnd clinic");

    return res.status(201).json({
      success: true,
      message: "Prescription created successfully.",
      data: populated,
    });

  } catch (error) {
    console.error("createPrescription error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating prescription." });
  }
};


// ─── GET /api/prescriptions/appointment/:appointmentId ────────────────────────
// Get prescription for a specific appointment
exports.getPrescriptionByAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const prescription = await Prescription.findOne({ appointment: appointmentId })
      .populate("doctor",      "name specialization")
      .populate("patient",     "userId age gender")
      .populate("appointment", "date slotStart slotEnd clinic");

    if (!prescription) {
      return res.status(404).json({ success: false, message: "No prescription found for this appointment." });
    }

    return res.status(200).json({ success: true, data: prescription });

  } catch (error) {
    console.error("getPrescriptionByAppointment error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};


// ─── PATCH /api/appointments/:id/complete ─────────────────────────────────────
// Doctor marks an appointment as completed + optionally updates slot times
exports.completeAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { slotStart, slotEnd, ... } = req.body || {};

    // ── 1. Role guard ─────────────────────────────
    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Only doctors can complete appointments." });
    }

    // ── 2. Validate ObjectId ──────────────────────
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment ID." });
    }

    // ── 3. Load doctor profile ────────────────────
    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    // ── 4. Load appointment ───────────────────────
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    // ── 5. Ownership check ────────────────────────
    if (appointment.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to update this appointment." });
    }

    // ── 6. Status guard ───────────────────────────
    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Cannot complete a cancelled appointment." });
    }

    if (appointment.status === "completed") {
      return res.status(400).json({ success: false, message: "Appointment is already completed." });
    }

    // ── 7. Update ─────────────────────────────────
    appointment.status = "completed";
    if (slotStart) appointment.slotStart = slotStart;
    if (slotEnd)   appointment.slotEnd   = slotEnd;

    await appointment.save();

    return res.status(200).json({
      success: true,
      message: "Appointment marked as completed.",
      data: appointment,
    });

  } catch (error) {
    console.error("completeAppointment error:", error);
    return res.status(500).json({ success: false, message: "Server error while completing appointment." });
  }
};