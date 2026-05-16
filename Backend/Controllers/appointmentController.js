// controllers/appointmentController.js
const mongoose = require("mongoose");
const Appointment = require("../Models/Appointment");
const Clinic = require("../Models/Clinic");
const Doctor = require("../Models/Doctors");
const Patient = require("../Models/Patients");
const Notification = require("../Models/Notification");
const Prescription = require("../Models/Prescription");
const Transaction = require("../Models/Transaction");
const { validateCard } = require("../utils/paymentUtils");

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

const isSameUTCDate = (a, b) => {
  const da = new Date(a), db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
};

const resolveScheduleForDate = (clinic, requestedDate) => {
  const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const requestedDayName = DAY_ORDER[requestedDate.getUTCDay()];

  const daysSinceSaturday = (requestedDate.getUTCDay() + 1) % 7;
  const weekStartDate = new Date(requestedDate);
  weekStartDate.setUTCDate(requestedDate.getUTCDate() - daysSinceSaturday);

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

// ─── Internal: create transaction + platform fee ──────────────────────────────
/**
 * Called after payment is confirmed (either online or at clinic).
 * Creates a Transaction and records 1.5% platform fee.
 *
 * @param {Object} params
 * @param {ObjectId} params.patientUserId   - User._id of the patient
 * @param {ObjectId} params.doctorUserId    - User._id of the doctor
 * @param {number}   params.amount          - clinic.price (session price)
 * @param {string}   params.paymentMethod   - 'cash' | 'online'
 * @param {ObjectId} params.appointmentId
 * @param {string}   params.doctorName
 */
const createAppointmentTransaction = async ({
  patientUserId,
  doctorUserId,
  amount,
  paymentMethod,
  appointmentId,
  doctorName,
}) => {
  const PLATFORM_FEE_RATE = 0.015; // 1.5%
  const platformFeeAmount = parseFloat((amount * PLATFORM_FEE_RATE).toFixed(2));

  await Transaction.create({
    payer: patientUserId,
    recipient: doctorUserId,
    amount,
    currency: "EGP",
    type: "appointment_fee",
    status: "completed",
    paymentMethod,
    platformFeeRate: PLATFORM_FEE_RATE,
    platformFeeAmount,
    platformFeePaid: false,           // doctor hasn't paid the app yet
    relatedModel: "Appointment",
    relatedId: appointmentId,
    note: `Appointment with Dr. ${doctorName}`,
  });
};

// ─── Book Appointment ─────────────────────────────────────────────────────────
/**
 * POST /api/appointments/book
 *
 * Body:
 *   clinicId, date, timeChosed, isFollowUp, paymentOption
 *
 * If paymentOption === "online", also required:
 *   cardNumber, expiryMonth, expiryYear, cvv, cardholderName
 *
 * paymentOption values: "online" | "at-clinic"
 */
exports.bookAppointment = async (req, res) => {
  try {
    const {
      clinicId,
      date,
      timeChosed,
      isFollowUp,
      paymentOption,
      // Online payment fields
      cardNumber,
      expiryMonth,
      expiryYear,
      cvv,
      cardholderName,
    } = req.body;

    // ── 1. Validation ─────────────────────────────
    if (!clinicId || !date || !timeChosed || !paymentOption) {
      return res.status(400).json({
        message: "clinicId, date, timeChosed, and paymentOption are required.",
      });
    }

    if (!["prePay", "atClinic"].includes(paymentOption)) {
      return res.status(400).json({
        message: 'paymentOption must be "prePay" or "atClinic".',
      });
    }

    // ── 2. Online payment: validate card BEFORE doing anything else ───────────
    // Fail fast — don't load clinic/patient until we know the card is valid.
    if (paymentOption === "prePay") {
      if (!cardNumber || !expiryMonth || !expiryYear || !cvv || !cardholderName) {
        return res.status(400).json({
          message:
            "cardNumber, expiryMonth, expiryYear, cvv, and cardholderName are required for online payment.",
        });
      }

      const cardValidation = validateCard({
        cardNumber,
        expiryMonth,
        expiryYear,
        cvv,
        cardholderName,
      });

      if (!cardValidation.valid) {
        return res.status(400).json({
          message: `Card validation failed: ${cardValidation.error}`,
        });
      }
    }

    // ── 3. Load clinic ────────────────────────────
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });

    // ── 4. Load patient ───────────────────────────
    const patientProfile = await Patient.findOne({ userId: req.user._id });
    if (!patientProfile)
      return res.status(404).json({ message: "Patient profile not found." });

    // ── 4.5 Block check ───────────────────────────
    await patientProfile.checkAndLiftBlock();
    if (patientProfile.isBlocked) {
      return res.status(403).json({
        message: `You are blocked from booking appointments until ${patientProfile.blockedUntil.toDateString()}. Reason: ${patientProfile.blockReason}`,
      });
    }

    // ── 5. Parse date ─────────────────────────────
    const requestedDate = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ message: "Invalid date format." });
    }

    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    if (requestedDate < todayUTC) {
      return res.status(400).json({ message: "Cannot book in the past." });
    }

    // ── 6. Resolve schedule ───────────────────────
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

    // ── 7. Resolve values ─────────────────────────
    const slotDuration = dayEntry.slotDuration ?? resolvedSlotDuration;
    const dailyCapacity = dayEntry.dailyCapacity ?? resolvedDailyCapacity;
    const patientsPerSlot = dayEntry.patientsPerSlot ?? resolvedPatientsPerSlot;

    // ── 8. Validate slot ──────────────────────────
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

    // ── 9. Prevent past slot today ────────────────
    const isToday = requestedDate.getTime() === todayUTC.getTime();
    if (isToday) {
      const nowMins = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      if (matchedSlot.end <= nowMins) {
        return res.status(400).json({ message: "Slot already passed." });
      }
    }

    // ── 10. Capacity checks ───────────────────────
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

    if (slotCount >= patientsPerSlot)
      return res.status(409).json({ message: "Slot is full." });
    if (dayCount >= dailyCapacity)
      return res.status(409).json({ message: "Day is full." });

    // ── 11. Prevent duplicate ─────────────────────
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

    // ── 12. Determine payment status ──────────────
    // Card passed validation above → mark as paid immediately
    const resolvedPaymentStatus = paymentOption === "prePay" ? "paid-online" : "pending"; // ✅

    // ── 13. Create appointment ────────────────────
    const appointment = await Appointment.create({
      patient: patientProfile._id,
      doctor: clinic.doctorId,
      clinic: clinic._id,
      date: requestedDate,
      timeChosed,
      slotStart,
      slotEnd,
      isFollowUp: isFollowUp ?? false,
      paymentOption,
      paymentStatus: resolvedPaymentStatus,
      status: "upcoming",
    });

    // ── 14. If paid online → create transaction immediately ───────────────────
    if (paymentOption === "prePay") {
      // Load doctor's User._id for the transaction recipient field
      const doctorProfile = await Doctor.findById(clinic.doctorId).populate("userId", "_id name");

      try {
        await createAppointmentTransaction({
          patientUserId: req.user._id,
          doctorUserId: doctorProfile.userId._id,
          amount: clinic.price,
          paymentMethod: "online",
          appointmentId: appointment._id,
          doctorName: doctorProfile.userId.name,
        });
      } catch (txErr) {
        // Don't fail the booking — just log
        console.error("Transaction creation failed (online):", txErr.message);
      }
    }

    // ── 15. Notification ──────────────────────────
    await Notification.create({
      recipient: req.user.id,
      title: "Appointment Booked",
      message: `Your appointment at ${clinic.name} on ${date} at ${timeChosed} has been confirmed.${paymentOption === "online" ? " Payment received online." : ""
        }`,
      type: "appointment",
    });

    return res.status(201).json({
      message: "Appointment booked successfully.",
      appointment,
      ...(paymentOption === "prePay" && {
        paymentInfo: {
          status: "paid-online",
          amount: clinic.price,
          currency: "EGP",
        },
      }),
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


// ─── Helper: check if appointment day has started ─────────────────────────────
const hasAppointmentDayStarted = (appointmentDate) => {
  const now = new Date();
  const apptDay = new Date(appointmentDate);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const apptDayStart = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate());
  return apptDayStart <= todayStart;
};


// ─── GET /appointments/my ─────────────────────────────────────────────────────

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
          populate: { path: "userId", model: "User", select: "name email phoneNumber" },
        })
        .populate("doctor", "name specialization")
        .populate("clinic", "name address price")
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
          populate: { path: "userId", model: "User", select: "name email phoneNumber" },
        })
        .populate("clinic", "name address price")
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


// ─── PATCH /appointments/:id/cancel ──────────────────────────────────────────

exports.cancelAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment ID." });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    let isAuthorized = false;

    if (req.user.role === "patient") {
      const patientProfile = await Patient.findOne({ userId: req.user._id });
      if (!patientProfile)
        return res.status(404).json({ success: false, message: "Patient profile not found." });
      isAuthorized = appointment.patient.toString() === patientProfile._id.toString();
    }

    if (req.user.role === "doctor") {
      const doctorProfile = await Doctor.findOne({ userId: req.user._id });
      if (!doctorProfile)
        return res.status(404).json({ success: false, message: "Doctor profile not found." });
      isAuthorized = appointment.doctor.toString() === doctorProfile._id.toString();
    }

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: "You are not authorized to cancel this appointment." });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Appointment is already cancelled." });
    }

    if (appointment.status === "completed") {
      return res.status(400).json({ success: false, message: "Cannot cancel a completed appointment." });
    }

    if (hasAppointmentDayStarted(appointment.date)) {
      return res.status(400).json({ success: false, message: "Cannot cancel an appointment on or after its scheduled day." });
    }

    appointment.status = "cancelled";
    appointment.paymentStatus = "cancelled";
    await appointment.save();

    return res.status(200).json({ success: true, message: "Appointment cancelled successfully.", data: appointment });

  } catch (error) {
    console.error("cancelAppointment error:", error);
    return res.status(500).json({ success: false, message: "Server error while cancelling appointment." });
  }
};


// ─── PATCH /appointments/:id/reschedule ──────────────────────────────────────

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


// ─── POST /appointments/:appointmentId/block-patient ─────────────────────────

exports.blockPatientForNoShow = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    if (!["doctor", "admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    const isPast = new Date(appointment.date) < new Date();
    const blockableStatuses = ["pending", "confirmed"];
    if (!isPast || !blockableStatuses.includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: "Can only block for past appointments with no prior cancellation or reschedule.",
      });
    }

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


// ─── PATCH /appointments/:id/mark-paid ───────────────────────────────────────
/**
 * Doctor or admin marks a cash appointment as paid at clinic.
 * After marking paid → creates a Transaction with 1.5% platform fee.
 */
exports.markAppointmentAsPaid = async (req, res) => {
  try {
    const { id } = req.params;

    // ── 1. Validate ObjectId ──────────────────────
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment ID." });
    }

    // ── 2. Role guard ─────────────────────────────
    if (!["doctor", "admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Only doctors or admins can mark payments." });
    }

    // ── 3. Load appointment ───────────────────────
    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    // ── 4. Ownership check ────────────────────────
    if (req.user.role === "doctor") {
      const doctorProfile = await Doctor.findOne({ userId: req.user._id });
      if (!doctorProfile) {
        return res.status(404).json({ success: false, message: "Doctor profile not found." });
      }
      if (appointment.doctor.toString() !== doctorProfile._id.toString()) {
        return res.status(403).json({ success: false, message: "You are not authorized to update this appointment." });
      }
    }

    // ── 5. Guard: don't re-pay / pay cancelled ────
    if (["paid-at-clinic", "paid-online"].includes(appointment.paymentStatus)) {
      return res.status(400).json({ success: false, message: "Appointment is already marked as paid." });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Cannot mark payment for a cancelled appointment." });
    }

    // ── 6. Update appointment ─────────────────────
    appointment.paymentStatus = "paid-at-clinic";
    appointment.paidAt = new Date();
    await appointment.save();

    // ── 7. Create transaction + platform fee ──────
    // Load clinic for the session price, and doctor for User._id
    const [clinic, doctorProfile] = await Promise.all([
      Clinic.findById(appointment.clinic),
      Doctor.findById(appointment.doctor).populate("userId", "_id name"),
    ]);

    // Load patient's User._id for the payer field
    const patientProfile = await Patient.findById(appointment.patient)
      .populate("userId", "_id");

    if (clinic && doctorProfile && patientProfile?.userId) {
      try {
        await createAppointmentTransaction({
          patientUserId: patientProfile.userId._id,
          doctorUserId: doctorProfile.userId._id,
          amount: clinic.price,
          paymentMethod: "cash",
          appointmentId: appointment._id,
          doctorName: doctorProfile.userId.name,
        });
      } catch (txErr) {
        // Non-blocking — appointment is already saved as paid
        console.error("Transaction creation failed (mark-paid):", txErr.message);
      }
    }

    // ── 8. Notify patient ─────────────────────────
    if (patientProfile?.userId) {
      await Notification.create({
        recipient: patientProfile.userId._id,
        title: "Payment Confirmed",
        message: `Your payment for the appointment on ${appointment.date.toDateString()} has been confirmed.`,
        type: "payment_confirmed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Appointment marked as paid successfully.",
      data: appointment,
      ...(clinic && {
        transactionInfo: {
          amount: clinic.price,
          platformFee: parseFloat((clinic.price * 0.015).toFixed(2)),
          currency: "EGP",
        },
      }),
    });

  } catch (error) {
    console.error("markAppointmentAsPaid error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating payment status." });
  }
};


// ─── GET /appointments/fee-summary ───────────────────────────────────────────
/**
 * Doctor views how much platform fee they owe for a given month.
 *
 * Query params: year (e.g. 2025), month (1–12)
 * Defaults to current month if not provided.
 *
 * FIX: Was using Transaction.monthlyFeeOwed(targetUserId) which maps to
 * recipient = doctor's User._id.  This is correct — but only transactions
 * whose status === 'completed' are counted.  We now also return a
 * totalAppointments count by joining against the Appointment collection
 * so the front-end can display it properly.
 */
exports.getDoctorFeeSummary = async (req, res) => {
  try {
    if (!["doctor", "admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const now   = new Date();
    const year  = parseInt(req.query.year,  10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    if (month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: "month must be between 1 and 12." });
    }

    // ── Resolve whose data to fetch ──────────────────────────────────────────
    // For a doctor: recipient = their User._id (stored directly in Transaction)
    // For an admin querying on behalf: pass ?doctorUserId=<User._id>
    let targetUserId = req.user._id;
    if (req.user.role === "admin" && req.query.doctorUserId) {
      targetUserId = req.query.doctorUserId;
    }

    // ── Build the month's date window (UTC) ──────────────────────────────────
    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const monthEnd   = new Date(Date.UTC(year, month,     1, 0, 0, 0, 0)); // exclusive

    // ── Aggregate transactions for this doctor in this month ─────────────────
    // Transaction schema fields used:
    //   recipient      : User._id of the doctor   ← this is how we filter
    //   amount         : session price (EGP)
    //   platformFeeAmount : pre-computed 1.5% fee
    //   status         : 'completed'
    //   createdAt      : when the transaction was recorded
    const pipeline = [
      {
        $match: {
          recipient: targetUserId,          // doctor's User._id
          status:    "completed",
          type:      "appointment_fee",
          createdAt: { $gte: monthStart, $lt: monthEnd },
        },
      },
      {
        $group: {
          _id:              null,
          totalRevenue:     { $sum: "$amount" },
          totalFee:         { $sum: "$platformFeeAmount" },
          count:            { $sum: 1 },
          relatedIds:       { $push: "$relatedId" },   // Appointment _ids
        },
      },
    ];

    const [agg] = await Transaction.aggregate(pipeline);

    // If no transactions exist this month, return zeroed summary
    if (!agg) {
      return res.status(200).json({
        success:          true,
        year,
        month,
        totalAppointments: 0,
        totalRevenue:      0,
        platformFeeOwed:   0,
        currency:          "EGP",
        feeRate:           "1.5%",
      });
    }

    return res.status(200).json({
      success:           true,
      year,
      month,
      totalAppointments: agg.count,
      totalRevenue:      parseFloat(agg.totalRevenue.toFixed(2)),
      platformFeeOwed:   parseFloat(agg.totalFee.toFixed(2)),
      currency:          "EGP",
      feeRate:           "1.5%",
    });

  } catch (error) {
    console.error("getDoctorFeeSummary error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─── Prescription endpoints (unchanged) ──────────────────────────────────────

exports.createPrescription = async (req, res) => {
  try {
    const { appointment: appointmentId, diagnosis, medicines, labTests, imaging, nextVisit, notes } = req.body;

    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Only doctors can create prescriptions." });
    }

    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    if (!appointmentId) {
      return res.status(400).json({ success: false, message: "appointment ID is required." });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (appointment.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to prescribe for this appointment." });
    }

    if (appointment.prescription) {
      return res.status(409).json({ success: false, message: "A prescription already exists for this appointment. Use update instead." });
    }

    const prescription = await Prescription.create({
      appointment: appointment._id,
      doctor: doctorProfile._id,
      patient: appointment.patient,
      diagnosis: diagnosis || "",
      medicines: medicines || [],
      labTests: labTests || [],
      imaging: imaging || [],
      nextVisit: nextVisit || "",
      notes: notes || "",
    });

    appointment.prescription = prescription._id;
    await appointment.save();

    const populated = await Prescription.findById(prescription._id)
      .populate("doctor", "name specialization")
      .populate("patient", "userId age gender")
      .populate("appointment", "date slotStart slotEnd clinic");

    return res.status(201).json({ success: true, message: "Prescription created successfully.", data: populated });

  } catch (error) {
    console.error("createPrescription error:", error);
    return res.status(500).json({ success: false, message: "Server error while creating prescription." });
  }
};

exports.getPrescriptionByAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const prescription = await Prescription.findOne({ appointment: appointmentId })
      .populate("doctor", "name specialization")
      .populate("patient", "userId age gender")
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

exports.completeAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { slotStart, slotEnd } = req.body || {};

    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Only doctors can complete appointments." });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment ID." });
    }

    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (appointment.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to update this appointment." });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Cannot complete a cancelled appointment." });
    }

    if (appointment.status === "completed") {
      return res.status(400).json({ success: false, message: "Appointment is already completed." });
    }

    appointment.status = "completed";
    if (slotStart) appointment.slotStart = slotStart;
    if (slotEnd) appointment.slotEnd = slotEnd;
    await appointment.save();

    return res.status(200).json({ success: true, message: "Appointment marked as completed.", data: appointment });

  } catch (error) {
    console.error("completeAppointment error:", error);
    return res.status(500).json({ success: false, message: "Server error while completing appointment." });
  }
};

exports.updatePrescription = async (req, res) => {
  try {
    const { id: prescriptionId } = req.params;
    const { diagnosis, medicines, labTests, imaging, nextVisit, notes } = req.body;

    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Only doctors can update prescriptions." });
    }

    if (!mongoose.Types.ObjectId.isValid(prescriptionId)) {
      return res.status(400).json({ success: false, message: "Invalid prescription ID." });
    }

    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const prescription = await Prescription.findOne({ appointment: prescriptionId });
    if (!prescription) {
      return res.status(404).json({ success: false, message: "Prescription not found." });
    }

    if (prescription.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to edit this prescription." });
    }

    if (diagnosis !== undefined) prescription.diagnosis = diagnosis;
    if (medicines !== undefined) prescription.medicines = medicines;
    if (labTests !== undefined) prescription.labTests = labTests;
    if (imaging !== undefined) prescription.imaging = imaging;
    if (nextVisit !== undefined) prescription.nextVisit = nextVisit;
    if (notes !== undefined) prescription.notes = notes;

    await prescription.save();

    const populated = await Prescription.findById(prescription._id)
      .populate("doctor", "name specialization")
      .populate("patient", "userId age gender")
      .populate("appointment", "date slotStart slotEnd clinic");

    return res.status(200).json({ success: true, message: "Prescription updated successfully.", data: populated });

  } catch (error) {
    console.error("updatePrescription error:", error);
    return res.status(500).json({ success: false, message: "Server error while updating prescription." });
  }
};

exports.getPreviousPrescription = async (req, res) => {
  try {
    const { id: appointmentId } = req.params;

    if (req.user.role !== "doctor") {
      return res.status(403).json({ success: false, message: "Only doctors can access previous prescriptions." });
    }

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ success: false, message: "Invalid appointment ID." });
    }

    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found." });
    }

    const currentAppointment = await Appointment.findById(appointmentId);
    if (!currentAppointment) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    if (currentAppointment.doctor.toString() !== doctorProfile._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to access this appointment." });
    }

    const previousPrescription = await Prescription.findOne({
      doctor: doctorProfile._id,
      patient: currentAppointment.patient,
      appointment: { $ne: currentAppointment._id },
    })
      .sort({ createdAt: -1 })
      .populate("doctor", "name specialization")
      .populate("patient", "userId age gender")
      .populate("appointment", "date slotStart slotEnd clinic isFollowUp");

    if (!previousPrescription) {
      return res.status(404).json({ success: false, message: "No previous prescription found for this patient." });
    }

    return res.status(200).json({ success: true, data: previousPrescription });

  } catch (error) {
    console.error("getPreviousPrescription error:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching previous prescription." });
  }
};