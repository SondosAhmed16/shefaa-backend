// controllers/clinicController.js
const Clinic = require("../Models/Clinic");
const Doctor = require("../Models/Doctors");
const Appointment = require("../Models/Appointment");
const Patient = require("../Models/Patients");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const timeToMins = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const minsToTime = (mins) => {
  const h = String(Math.floor(mins / 60) % 24).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
};

const overlaps = (s1, e1, s2, e2) => s1 < e2 && e1 > s2;

const rangesOverlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

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

const resolveScheduleSlots = (schedule) => {
  const { days, slotDuration } = schedule;
  const result = {};
  for (const day of days) {
    if (!day.isActive || day.isDayLocked) continue;
    const dur = day.slotDuration ?? slotDuration;
    result[day.day] = buildDaySlots(day.open, day.close, day.breaks, dur);
  }
  return result;
};

const checkNoOverlapForDoctor = async (doctorId, newDays, excludeClinicId = null) => {
  const query = { doctorId, status: { $ne: "rejected" } };
  if (excludeClinicId) query._id = { $ne: excludeClinicId };

  const existingClinics = await Clinic.find(query).lean();

  for (const existing of existingClinics) {
    if (!existing.defaultSchedule?.days?.length) continue;

    for (const existDay of existing.defaultSchedule.days) {
      if (!existDay.isActive) continue;
      const newDay = newDays.find((d) => d.day === existDay.day);
      if (!newDay || !newDay.isActive) continue;
      if (rangesOverlap(newDay.open, newDay.close, existDay.open, existDay.close)) {
        return {
          conflict: true,
          message: `Schedule conflict on ${existDay.day}: clinic "${existing.name}" runs ${existDay.open}–${existDay.close} mins, overlaps with ${newDay.open}–${newDay.close} mins.`,
        };
      }
    }
  }
  return { conflict: false };
};

const buildSlots = ({ open, close, slotDuration, dailyCapacity, breaks = [] }) => {
  const validBreaks = breaks.filter(
    (b) => b.start != null && b.end != null && b.start < b.end
  );

  const slots = [];
  let index = 1;

  for (let t = open; t + slotDuration <= close; t += slotDuration) {
    const slotEnd = t + slotDuration;

    const blocked = validBreaks.some((b) => overlaps(t, slotEnd, b.start, b.end));
    if (blocked) continue;

    slots.push({
      index,
      start: t,
      end: slotEnd,
      startTime: minsToTime(t),
      endTime: minsToTime(slotEnd),
      available: true,
    });
    index++;

    if (dailyCapacity != null && slots.length >= dailyCapacity) break;
  }

  return slots;
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

exports.createClinic = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    const doctorId = doctor._id;

    const { name, city, address, location, price, operatingLicense, schedule } = req.body;

    if (!name || !city || !address || !location?.coordinates || price == null || !schedule) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const { slotDuration, dailyCapacity, patientsPerSlot = 1, days = [] } = schedule;

    if (!slotDuration || slotDuration < 5)
      return res.status(400).json({ message: "slotDuration must be ≥ 5 minutes." });
    if (!dailyCapacity || dailyCapacity < 1)
      return res.status(400).json({ message: "dailyCapacity must be ≥ 1." });
    if (!days.length)
      return res.status(400).json({ message: "At least one working day is required." });

    const VALID_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

    const normalisedDays = days.map((d, i) => {
      if (!VALID_DAYS.includes(d.day))
        throw { status: 400, message: `Invalid day "${d.day}" at index ${i}.` };
      const open = typeof d.open === "string" ? timeToMins(d.open) : d.open;
      const close = typeof d.close === "string" ? timeToMins(d.close) : d.close;
      if (open >= close)
        throw { status: 400, message: `${d.day}: open time must be before close time.` };

      const breaks = (d.breaks || []).map((br) => {
        const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
        const bEnd = typeof br.end === "string" ? timeToMins(br.end) : br.end;
        if (bStart < open || bEnd > close || bStart >= bEnd)
          throw { status: 400, message: `${d.day}: break ${bStart}–${bEnd} is invalid.` };
        return { start: bStart, end: bEnd, label: br.label || "" };
      });

      return {
        day: d.day,
        isActive: d.isActive !== false,
        open, close, breaks,
        slotDuration: d.slotDuration ?? null,
        dailyCapacity: d.dailyCapacity ?? null,
        patientsPerSlot: d.patientsPerSlot ?? null,
        isDayLocked: d.isDayLocked ?? false,
        isBookingLocked: d.isBookingLocked ?? false,
      };
    });

    const dayNames = normalisedDays.map((d) => d.day);
    if (new Set(dayNames).size !== dayNames.length)
      return res.status(400).json({ message: "Duplicate days found in schedule." });

    const activeDays = normalisedDays.filter((d) => d.isActive);
    const { conflict, message: conflictMsg } = await checkNoOverlapForDoctor(doctorId, activeDays);
    if (conflict) return res.status(409).json({ message: conflictMsg });

    const clinic = await Clinic.create({
      doctorId,
      name: name.trim(), city: city.trim(), address: address.trim(),
      location: { type: "Point", coordinates: location.coordinates },
      price, operatingLicense: operatingLicense || "",
      defaultSchedule: { days: normalisedDays, slotDuration, dailyCapacity, patientsPerSlot },
    });

    await Doctor.findByIdAndUpdate(doctorId, { $push: { clinics: clinic._id } });

    const slotsPreview = resolveScheduleSlots(clinic.defaultSchedule);

    return res.status(201).json({ message: "Clinic created successfully.", clinic, slotsPreview });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("createClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.editClinic = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    const doctorId = doctor._id;

    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctorId.toString())
      return res.status(403).json({ message: "Not authorized." });

    const { name, city, address, location, price, operatingLicense, schedule, status } = req.body;

    if (schedule) {
      const {
        slotDuration = clinic.defaultSchedule.slotDuration,
        dailyCapacity = clinic.defaultSchedule.dailyCapacity,
        patientsPerSlot = clinic.defaultSchedule.patientsPerSlot,
        days = [],
      } = schedule;

      if (slotDuration < 5)
        return res.status(400).json({ message: "slotDuration must be ≥ 5 minutes." });
      if (dailyCapacity < 1)
        return res.status(400).json({ message: "dailyCapacity must be ≥ 1." });
      if (!days.length)
        return res.status(400).json({ message: "At least one working day is required." });

      const VALID_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

      const normalisedDays = days.map((d, i) => {
        if (!VALID_DAYS.includes(d.day))
          throw { status: 400, message: `Invalid day "${d.day}" at index ${i}.` };
        const open = typeof d.open === "string" ? timeToMins(d.open) : d.open;
        const close = typeof d.close === "string" ? timeToMins(d.close) : d.close;
        if (open >= close)
          throw { status: 400, message: `${d.day}: open time must be before close time.` };

        const breaks = (d.breaks || []).map((br) => {
          const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
          const bEnd = typeof br.end === "string" ? timeToMins(br.end) : br.end;
          if (bStart < open || bEnd > close || bStart >= bEnd)
            throw { status: 400, message: `${d.day}: break ${bStart}–${bEnd} is invalid.` };
          return { start: bStart, end: bEnd, label: br.label || "" };
        });

        return {
          day: d.day,
          isActive: d.isActive !== false,
          open, close, breaks,
          slotDuration: d.slotDuration ?? null,
          dailyCapacity: d.dailyCapacity ?? null,
          patientsPerSlot: d.patientsPerSlot ?? null,
          isDayLocked: d.isDayLocked ?? false,
          isBookingLocked: d.isBookingLocked ?? false,
        };
      });

      const dayNames = normalisedDays.map((d) => d.day);
      if (new Set(dayNames).size !== dayNames.length)
        return res.status(400).json({ message: "Duplicate days found in schedule." });

      const activeDays = normalisedDays.filter((d) => d.isActive);
      const { conflict, message: conflictMsg } = await checkNoOverlapForDoctor(doctorId, activeDays, clinic._id);
      if (conflict) return res.status(409).json({ message: conflictMsg });

      clinic.defaultSchedule.days = normalisedDays;
      clinic.defaultSchedule.slotDuration = slotDuration;
      clinic.defaultSchedule.dailyCapacity = dailyCapacity;
      clinic.defaultSchedule.patientsPerSlot = patientsPerSlot;
    }

    if (name) clinic.name = name.trim();
    if (city) clinic.city = city.trim();
    if (address) clinic.address = address.trim();
    if (price != null) clinic.price = price;
    if (operatingLicense !== undefined) clinic.operatingLicense = operatingLicense;
    if (status) clinic.status = status;
    if (location?.coordinates) clinic.location = { type: "Point", coordinates: location.coordinates };

    await clinic.save();
    return res.status(200).json({ message: "Clinic updated successfully.", clinic });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("editClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.getClinic = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    const clinic = await Clinic.findById(req.params.id).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });
    return res.status(200).json({ message: "Clinic fetched successfully.", clinic });
  } catch (err) {
    console.error("getClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.deleteClinic = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });
    await clinic.deleteOne();
    await Doctor.findByIdAndUpdate(doctor._id, { $pull: { clinics: clinic._id } });
    return res.status(200).json({ message: "Clinic deleted successfully." });
  } catch (err) {
    console.error("deleteClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── GET Day Slots ────────────────────────────────────────────────────────────
// GET /api/clinic/:id/day-slots?date=YYYY-MM-DD
//
// Response status values:
//   "open"           — normal, slots available for booking
//   "booking_locked" — slots visible but isBookingLocked = true
//   "day_locked"     — isDayLocked = true, no slots returned
//   "closed"         — isActive = false or day not in schedule
//
// Slot reason values (when available = false):
//   "expired"              — past date, slot was never booked
//   "Slot is fully booked." — patientsPerSlot reached
//   "Daily capacity reached." — dailyCapacity reached
// ─────────────────────────────────────────────────────────────────────────────

exports.getDaySlots = async (req, res) => {
  try {
    // ── 1. Identify user role ───────────────────────────────────────────────
    let doctor = null;
    let patient = null;

    if (req.user.role === "doctor") {
      doctor = await Doctor.findOne({ userId: req.user._id });
      if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    }

    if (req.user.role === "patient") {
      patient = await Patient.findOne({ userId: req.user._id });
      if (!patient) return res.status(403).json({ message: "Patient profile not found." });
    }

    // ── 2. Load clinic ──────────────────────────────────────────────────────
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });

    if (doctor && clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });

    // ── 3. Parse & validate date ────────────────────────────────────────────
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: "Query param 'date' is required (YYYY-MM-DD)." });
    }

    const requestedDate = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD." });
    }

    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const isPast = requestedDate < todayUTC;

    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = DAYS[requestedDate.getUTCDay()];

    // ── 4. Get schedule from defaultSchedule directly ───────────────────────
    const schedule = clinic.defaultSchedule;

    // ── 5. Get day entry ────────────────────────────────────────────────────
    const dayEntry = schedule.days.find((d) => d.day === dayName);

    const base = { date, day: dayName, isPast };

    if (!dayEntry) {
      return res.status(200).json({
        ...base,
        status: "closed",
        reason: "Day not found in clinic schedule.",
        open: null,
        close: null,
        slotDuration: schedule.slotDuration,
        totalSlots: 0,
        breaks: [],
        slots: [],
      });
    }

    if (!dayEntry.isActive) {
      return res.status(200).json({
        ...base,
        status: "closed",
        reason: "Clinic is closed on this day.",
        open: null,
        close: null,
        slotDuration: schedule.slotDuration,
        totalSlots: 0,
        breaks: [],
        slots: [],
      });
    }

    if (dayEntry.isDayLocked) {
      return res.status(200).json({
        ...base,
        status: "day_locked",
        reason: "This day is fully locked.",
        open: dayEntry.open,
        close: dayEntry.close,
        slotDuration: dayEntry.slotDuration ?? schedule.slotDuration,
        totalSlots: 0,
        breaks: dayEntry.breaks ?? [],
        slots: [],
      });
    }

    // ── 6. Resolve slot settings ────────────────────────────────────────────
    const slotDuration = dayEntry.slotDuration ?? schedule.slotDuration;
    const dailyCapacity = dayEntry.dailyCapacity ?? schedule.dailyCapacity;
    const patientsPerSlot = dayEntry.patientsPerSlot ?? schedule.patientsPerSlot;

    // ── 7. Generate raw slots ───────────────────────────────────────────────
    const rawSlots = buildSlots({
      open: dayEntry.open,
      close: dayEntry.close,
      slotDuration,
      dailyCapacity,
      breaks: dayEntry.breaks ?? [],
    });

    // ── 8. Get booked appointments ──────────────────────────────────────────
    const OCCUPYING_STATUSES = ["upcoming", "inProgress", "completed"];

    const bookedAgg = await Appointment.aggregate([
      {
        $match: {
          clinic: clinic._id,
          date: requestedDate,
          status: { $in: OCCUPYING_STATUSES },
        },
      },
      {
        $group: {
          _id: "$slotStart",
          count: { $sum: 1 },
        },
      },
    ]);

    const bookedPerSlot = {};
    let totalBookedToday = 0;

    for (const entry of bookedAgg) {
      bookedPerSlot[entry._id] = entry.count;
      totalBookedToday += entry.count;
    }

    // ── 9. Build final slots ────────────────────────────────────────────────
    const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
    const nowMins = nowLocal.getHours() * 60 + nowLocal.getMinutes();
    const todayLocal = nowLocal.toISOString().slice(0, 10); // still YYYY-MM-DD
    const isToday = !isPast && requestedDate.toISOString().slice(0, 10) === todayLocal;

    const slots = rawSlots.map((slot) => {
      const bookedCount = bookedPerSlot[slot.startTime] ?? 0;
      const slotFull = bookedCount >= patientsPerSlot;
      const dayFull = totalBookedToday >= dailyCapacity;

      // expired لو: past date وملقيش حجوزات، أو today والوقت عدى على الـ slot وملقيش حجوزات
      const isExpired = (isPast && bookedCount === 0) || (isToday && slot.end <= nowMins && bookedCount === 0);
      const isAvailable = !isPast && !slotFull && !dayFull && !(isToday && slot.end <= nowMins);

      return {
        ...slot,
        available: isAvailable,
        bookedCount,
        patientsPerSlot,
        remainingInSlot: isAvailable ? Math.max(0, patientsPerSlot - bookedCount) : 0,
        remainingInDay: isAvailable ? Math.max(0, dailyCapacity - totalBookedToday) : 0,
        ...(!isAvailable && {
          reason: isExpired
            ? "expired"
            : slotFull
              ? "Slot is fully booked."
              : "Daily capacity reached.",
        }),
      };
    });

    // ── 10. Response ────────────────────────────────────────────────────────
    const status = dayEntry.isBookingLocked ? "booking_locked" : "open";

    return res.status(200).json({
      ...base,
      status,
      ...(dayEntry.isBookingLocked && { reason: "New bookings are locked for this day." }),
      open: dayEntry.open,
      close: dayEntry.close,
      slotDuration,
      dailyCapacity,
      patientsPerSlot,
      totalBookedToday,
      totalSlots: slots.length,
      hasAppointments: totalBookedToday > 0,
      breaks: (dayEntry.breaks ?? []).map((b) => ({
        start: b.start,
        end: b.end,
        label: b.label ?? "",
      })),
      slots,
    });

  } catch (err) {
    console.error("getDaySlots error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};


// controllers/clinicController.js  (add below your existing exports)

// ─── GET Clinic + Today's Slots (patient-facing) ──────────────────────────────
// GET /api/clinic/:id/today
//
// Returns the full clinic document merged with a live slot breakdown for today.
// The date is resolved server-side in Africa/Cairo time so the client never
// needs to pass a date param.
// ─────────────────────────────────────────────────────────────────────────────

exports.getClinicWithTodaySlots = async (req, res) => {
  try {
    // ── 1. Auth: patient only ───────────────────────────────────────────────
    const patient = await Patient.findOne({ userId: req.user._id });
    if (!patient) return res.status(403).json({ message: "Patient profile not found." });

    // ── 2. Load clinic ──────────────────────────────────────────────────────
    const clinic = await Clinic.findById(req.params.id).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });

    const { defaultSchedule: schedule, ...clinicInfo } = clinic;  // ← schedule is declared HERE

    // ── 3. Resolve today in Cairo time ──────────────────────────────────────
    const nowLocal = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" })
    );

    const todayStr = nowLocal.toISOString().slice(0, 10);
    const nowMins = nowLocal.getHours() * 60 + nowLocal.getMinutes();
    const todayUTC = new Date(`${todayStr}T00:00:00.000Z`);

    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = DAYS[nowLocal.getDay()];

    // ── 4. Pull schedule info ───────────────────────────────────────────────
    // ✅ DO NOT redeclare schedule here — it's already available from step 2
    const dayEntry = schedule?.days?.find((d) => d.day === dayName);

    const baseToday = { date: todayStr, day: dayName };

    // ── 5. Early exits: closed / locked states ──────────────────────────────
    if (!dayEntry) {
      return res.status(200).json({
        clinic,
        today: {
          ...baseToday,
          status: "closed",
          reason: "Day not found in clinic schedule.",
          totalSlots: 0,
          breaks: [],
          slots: [],
        },
      });
    }

    if (!dayEntry.isActive) {
      return res.status(200).json({
        clinic,
        today: {
          ...baseToday,
          status: "closed",
          reason: "Clinic is closed today.",
          totalSlots: 0,
          breaks: dayEntry.breaks ?? [],
          slots: [],
        },
      });
    }

    if (dayEntry.isDayLocked) {
      return res.status(200).json({
        clinic,
        today: {
          ...baseToday,
          status: "day_locked",
          reason: "This day is fully locked.",
          open: dayEntry.open,
          close: dayEntry.close,
          slotDuration: dayEntry.slotDuration ?? schedule.slotDuration,
          totalSlots: 0,
          breaks: dayEntry.breaks ?? [],
          slots: [],
        },
      });
    }

    // ── 6. Resolve slot settings ────────────────────────────────────────────
    const slotDuration = dayEntry.slotDuration ?? schedule.slotDuration;
    const dailyCapacity = dayEntry.dailyCapacity ?? schedule.dailyCapacity;
    const patientsPerSlot = dayEntry.patientsPerSlot ?? schedule.patientsPerSlot;

    // ── 7. Generate raw slots ───────────────────────────────────────────────
    const rawSlots = buildSlots({
      open: dayEntry.open,
      close: dayEntry.close,
      slotDuration,
      dailyCapacity,
      breaks: dayEntry.breaks ?? [],
    });

    // ── 8. Count active bookings per slot for today ─────────────────────────
    const OCCUPYING_STATUSES = ["upcoming", "inProgress", "completed"];

    const bookedAgg = await Appointment.aggregate([
      {
        $match: {
          clinic: clinic._id,
          date: todayUTC,
          status: { $in: OCCUPYING_STATUSES },
        },
      },
      {
        $group: {
          _id: "$slotStart",
          count: { $sum: 1 },
        },
      },
    ]);

    const bookedPerSlot = {};
    let totalBookedToday = 0;

    for (const entry of bookedAgg) {
      bookedPerSlot[entry._id] = entry.count;
      totalBookedToday += entry.count;
    }

    // ── 9. Annotate slots ───────────────────────────────────────────────────
    const slots = rawSlots.map((slot) => {
      const bookedCount = bookedPerSlot[slot.startTime] ?? 0;
      const slotFull = bookedCount >= patientsPerSlot;
      const dayFull = totalBookedToday >= dailyCapacity;
      const isPastSlot = slot.end <= nowMins;

      // "expired" = slot time has passed AND no bookings exist for it
      const isExpired = isPastSlot && bookedCount === 0;
      const isAvailable = !slotFull && !dayFull && !isPastSlot;

      return {
        ...slot,
        available: isAvailable,
        bookedCount,
        patientsPerSlot,
        remainingInSlot: isAvailable ? Math.max(0, patientsPerSlot - bookedCount) : 0,
        remainingInDay: isAvailable ? Math.max(0, dailyCapacity - totalBookedToday) : 0,
        ...(!isAvailable && {
          reason: isExpired
            ? "expired"
            : slotFull
              ? "Slot is fully booked."
              : "Daily capacity reached.",
        }),
      };
    });

    // ── 10. Final response ──────────────────────────────────────────────────
    const status = dayEntry.isBookingLocked ? "booking_locked" : "open";

    return res.status(200).json({
      clinic: clinicInfo,                          // full clinic document
      today: {
        ...baseToday,
        status,
        ...(dayEntry.isBookingLocked && {
          reason: "New bookings are locked for this day.",
        }),
        open: dayEntry.open,
        close: dayEntry.close,
        slotDuration,
        dailyCapacity,
        patientsPerSlot,
        totalBookedToday,
        totalSlots: slots.length,
        hasAppointments: totalBookedToday > 0,
        breaks: (dayEntry.breaks ?? []).map((b) => ({
          start: b.start,
          end: b.end,
          label: b.label ?? "",
        })),
        slots,
      },
    });

  } catch (err) {
    console.error("getClinicWithTodaySlots error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};