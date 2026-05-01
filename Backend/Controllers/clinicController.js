// controllers/clinicController.js
const Clinic = require("../Models/Clinic");
const Doctor = require("../Models/Doctors");
const Appointment = require("../Models/Appointment");

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

const getWeekStart = (date) => {
  const d = new Date(date);
  // اشتغل بـ UTC عشان يتطابق مع اللي المخزن في الـ DB
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 6 ? 0 : day + 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const overlaps = (s1, e1, s2, e2) => s1 < e2 && e1 > s2;

const rangesOverlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// Used by createClinic / editClinic / overrideWeekSchedule slotsPreview
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

const resolveScheduleSlots = (resolvedWeek) => {
  const { days, slotDuration } = resolvedWeek;
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

/**
 * Build enriched time slots for getDaySlots.
 * Respects breaks, dailyCapacity cap, and returns human-readable times.
 */
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
      start:     t,
      end:       slotEnd,
      startTime: minsToTime(t),
      endTime:   minsToTime(slotEnd),
      available: true, // flip to false once Appointments collection is wired up
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
      const open  = typeof d.open  === "string" ? timeToMins(d.open)  : d.open;
      const close = typeof d.close === "string" ? timeToMins(d.close) : d.close;
      if (open >= close)
        throw { status: 400, message: `${d.day}: open time must be before close time.` };

      const breaks = (d.breaks || []).map((br) => {
        const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
        const bEnd   = typeof br.end   === "string" ? timeToMins(br.end)   : br.end;
        if (bStart < open || bEnd > close || bStart >= bEnd)
          throw { status: 400, message: `${d.day}: break ${bStart}–${bEnd} is invalid.` };
        return { start: bStart, end: bEnd, label: br.label || "" };
      });

      return {
        day: d.day, isActive: d.isActive !== false,
        open, close, breaks,
        slotDuration:    d.slotDuration    ?? null,
        dailyCapacity:   d.dailyCapacity   ?? null,
        patientsPerSlot: d.patientsPerSlot ?? null,
        isDayLocked:     d.isDayLocked     ?? false,
        isBookingLocked: d.isBookingLocked ?? false,
        hasAppointments: false,
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

    const resolvedWeek  = clinic.resolveWeek(new Date());
    const slotsPreview  = resolveScheduleSlots({ ...resolvedWeek, slotDuration });

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
        slotDuration    = clinic.defaultSchedule.slotDuration,
        dailyCapacity   = clinic.defaultSchedule.dailyCapacity,
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
        const open  = typeof d.open  === "string" ? timeToMins(d.open)  : d.open;
        const close = typeof d.close === "string" ? timeToMins(d.close) : d.close;
        if (open >= close)
          throw { status: 400, message: `${d.day}: open time must be before close time.` };

        const breaks = (d.breaks || []).map((br) => {
          const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
          const bEnd   = typeof br.end   === "string" ? timeToMins(br.end)   : br.end;
          if (bStart < open || bEnd > close || bStart >= bEnd)
            throw { status: 400, message: `${d.day}: break ${bStart}–${bEnd} is invalid.` };
          return { start: bStart, end: bEnd, label: br.label || "" };
        });

        return {
          day: d.day, isActive: d.isActive !== false, open, close, breaks,
          slotDuration:    d.slotDuration    ?? null,
          dailyCapacity:   d.dailyCapacity   ?? null,
          patientsPerSlot: d.patientsPerSlot ?? null,
          isDayLocked:     d.isDayLocked     ?? false,
          isBookingLocked: d.isBookingLocked ?? false,
          hasAppointments: d.hasAppointments ?? false,
        };
      });

      const dayNames = normalisedDays.map((d) => d.day);
      if (new Set(dayNames).size !== dayNames.length)
        return res.status(400).json({ message: "Duplicate days found in schedule." });

      const activeDays = normalisedDays.filter((d) => d.isActive);
      const { conflict, message: conflictMsg } = await checkNoOverlapForDoctor(doctorId, activeDays, clinic._id);
      if (conflict) return res.status(409).json({ message: conflictMsg });

      clinic.defaultSchedule.days            = normalisedDays;
      clinic.defaultSchedule.slotDuration    = slotDuration;
      clinic.defaultSchedule.dailyCapacity   = dailyCapacity;
      clinic.defaultSchedule.patientsPerSlot = patientsPerSlot;
    }

    if (name)                         clinic.name             = name.trim();
    if (city)                         clinic.city             = city.trim();
    if (address)                      clinic.address          = address.trim();
    if (price != null)                clinic.price            = price;
    if (operatingLicense !== undefined) clinic.operatingLicense = operatingLicense;
    if (status)                       clinic.status           = status;
    if (location?.coordinates)        clinic.location         = { type: "Point", coordinates: location.coordinates };

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

// ─── Week Override ────────────────────────────────────────────────────────────

exports.overrideWeekSchedule = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });

    const { weekStart, days = [] } = req.body;
    if (!weekStart) return res.status(400).json({ message: "weekStart is required." });

    const weekStartDate = new Date(weekStart);
    if (isNaN(weekStartDate.getTime()))
      return res.status(400).json({ message: "Invalid weekStart date." });
    if (!Array.isArray(days))
      return res.status(400).json({ message: "days must be an array." });

    const VALID_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const defaultDays = clinic.defaultSchedule.days;

    const normalisedOverrideDays = days.map((d, i) => {
      if (!VALID_DAYS.includes(d.day))
        throw { status: 400, message: `Invalid day "${d.day}" at index ${i}.` };

      const defDay = defaultDays.find((dd) => dd.day === d.day);
      const open  = d.open  != null ? (typeof d.open  === "string" ? timeToMins(d.open)  : d.open)  : defDay?.open;
      const close = d.close != null ? (typeof d.close === "string" ? timeToMins(d.close) : d.close) : defDay?.close;

      if (open == null || close == null)
        throw { status: 400, message: `${d.day}: open and close are required (no default found).` };
      if (open >= close)
        throw { status: 400, message: `${d.day}: open must be before close.` };

      let breaks = defDay?.breaks ?? [];
      if (d.breaks !== undefined) {
        breaks = (d.breaks || []).map((br) => {
          const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
          const bEnd   = typeof br.end   === "string" ? timeToMins(br.end)   : br.end;
          if (bStart < open || bEnd > close || bStart >= bEnd)
            throw { status: 400, message: `${d.day}: invalid break ${bStart}–${bEnd}.` };
          return { start: bStart, end: bEnd, label: br.label || "" };
        });
      }

      return {
        day:  d.day,
        isActive:        d.isActive        ?? defDay?.isActive        ?? true,
        open, close, breaks,
        slotDuration:    d.slotDuration    ?? defDay?.slotDuration    ?? null,
        dailyCapacity:   d.dailyCapacity   ?? defDay?.dailyCapacity   ?? null,
        patientsPerSlot: d.patientsPerSlot ?? defDay?.patientsPerSlot ?? null,
        isDayLocked:     d.isDayLocked     ?? defDay?.isDayLocked     ?? false,
        isBookingLocked: d.isBookingLocked ?? defDay?.isBookingLocked ?? false,
        // ✅ Preserve existing hasAppointments unless explicitly sent
        hasAppointments: d.hasAppointments ?? defDay?.hasAppointments ?? false,
      };
    });

    const dayNames = normalisedOverrideDays.map((d) => d.day);
    if (new Set(dayNames).size !== dayNames.length)
      return res.status(400).json({ message: "Duplicate days in request." });

    const existingOverrideIdx = clinic.weeklyOverrides.findIndex(
      (o) => o.weekStart.toISOString() === weekStartDate.toISOString()
    );

    if (existingOverrideIdx === -1) {
      clinic.weeklyOverrides.push({
        weekStart:       weekStartDate,
        days:            normalisedOverrideDays,
        slotDuration:    req.body.slotDuration    ?? null,
        dailyCapacity:   req.body.dailyCapacity   ?? null,
        patientsPerSlot: req.body.patientsPerSlot ?? null,
      });
    } else {
      const existing = clinic.weeklyOverrides[existingOverrideIdx];
      for (const newDay of normalisedOverrideDays) {
        const idx = existing.days.findIndex((d) => d.day === newDay.day);
        if (idx === -1) {
          existing.days.push(newDay);
        } else {
          // ✅ Never overwrite hasAppointments with false if it was already true
          const prevHasAppointments = existing.days[idx].hasAppointments;
          existing.days[idx] = {
            ...newDay,
            hasAppointments: prevHasAppointments || newDay.hasAppointments,
          };
        }
      }
      if (req.body.slotDuration    != null) existing.slotDuration    = req.body.slotDuration;
      if (req.body.dailyCapacity   != null) existing.dailyCapacity   = req.body.dailyCapacity;
      if (req.body.patientsPerSlot != null) existing.patientsPerSlot = req.body.patientsPerSlot;
    }

    await clinic.save();

    const resolvedWeek = clinic.resolveWeek(weekStartDate);
    const slotsPreview = resolveScheduleSlots(resolvedWeek);

    return res.status(200).json({
      message: "Week schedule overridden successfully.",
      weekStart: weekStartDate,
      resolvedWeek,
      slotsPreview,
    });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("overrideWeekSchedule error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.deleteWeekOverride = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });

    const { weekStart } = req.body;
    if (!weekStart) return res.status(400).json({ message: "weekStart is required." });

    const weekStartDate = new Date(weekStart);
    const before = clinic.weeklyOverrides.length;
    clinic.weeklyOverrides = clinic.weeklyOverrides.filter(
      (o) => o.weekStart.toISOString() !== weekStartDate.toISOString()
    );
    if (clinic.weeklyOverrides.length === before)
      return res.status(404).json({ message: "No override found for this week." });

    await clinic.save();
    return res.status(200).json({ message: "Override removed. Default schedule restored." });

  } catch (err) {
    console.error("deleteWeekOverride error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── Day Appointment Flag ─────────────────────────────────────────────────────

exports.setDayAppointmentFlag = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });

    const { weekStart, day, hasAppointments } = req.body;
    if (!weekStart || !day || hasAppointments === undefined) {
      return res.status(400).json({ message: "weekStart, day, and hasAppointments are required." });
    }

    const VALID_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    if (!VALID_DAYS.includes(day))
      return res.status(400).json({ message: `Invalid day "${day}".` });

    const weekStartDate = new Date(weekStart);
    if (isNaN(weekStartDate.getTime()))
      return res.status(400).json({ message: "Invalid weekStart date." });

    let overrideIdx = clinic.weeklyOverrides.findIndex(
      (o) => o.weekStart.toISOString() === weekStartDate.toISOString()
    );

    if (overrideIdx === -1) {
      clinic.weeklyOverrides.push({ weekStart: weekStartDate, days: [] });
      overrideIdx = clinic.weeklyOverrides.length - 1;
    }

    const override = clinic.weeklyOverrides[overrideIdx];
    const dayIdx   = override.days.findIndex((d) => d.day === day);

    if (dayIdx === -1) {
      const defDay = clinic.defaultSchedule.days.find((d) => d.day === day);
      if (!defDay)
        return res.status(404).json({ message: `Day "${day}" not found in default schedule.` });
      override.days.push({ ...defDay.toObject(), hasAppointments: Boolean(hasAppointments) });
    } else {
      override.days[dayIdx].hasAppointments = Boolean(hasAppointments);
    }

    await clinic.save();
    return res.status(200).json({
      message: `hasAppointments for ${day} set to ${hasAppointments}.`,
      weekStart: weekStartDate,
      day,
      hasAppointments: Boolean(hasAppointments),
    });
  } catch (err) {
    console.error("setDayAppointmentFlag error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── GET Day Slots ────────────────────────────────────────────────────────────
// GET /api/clinic/:id/day-slots?date=YYYY-MM-DD
//
// Returns resolved appointment slots for a specific day.
// Merges weeklyOverrides on top of defaultSchedule (same as the UI's resolveDay).
//
// Response status values:
//   "open"           — normal, slots available for booking
//   "booking_locked" — slots visible but isBookingLocked = true
//   "day_locked"     — isDayLocked = true, no slots returned
//   "closed"         — isActive = false or day not in schedule
// ─────────────────────────────────────────────────────────────────────────────

exports.getDaySlots = async (req, res) => {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    // ── 2. Load clinic ────────────────────────────────────────────────────────
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });

    // ── 3. Parse & validate the requested date ────────────────────────────────
    const { date } = req.query;
    if (!date)
      return res.status(400).json({ message: "Query param 'date' is required (YYYY-MM-DD)." });

    const requestedDate = new Date(`${date}T00:00:00.000Z`); // ✅ UTC midnight دايماً
    if (isNaN(requestedDate.getTime()))
      return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD." });

    const DAYS    = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = DAYS[requestedDate.getUTCDay()]; // ✅ UTC

    // ── 4. Resolve the week ───────────────────────────────────────────────────
    const weekStart = getWeekStart(requestedDate);
    const resolved  = clinic.resolveWeek(weekStart);

    // ── 5. Find the day entry ─────────────────────────────────────────────────
    const dayEntry = resolved.days.find((d) => d.day === dayName);

    const base = {
      date:      date,
      day:       dayName,
      weekStart: weekStart.toISOString(),
    };

    if (!dayEntry) {
      return res.status(200).json({
        ...base, status: "closed",
        reason: "Day not found in clinic schedule.",
        open: null, close: null,
        slotDuration: resolved.slotDuration,
        totalSlots: 0, breaks: [], slots: [],
      });
    }

    if (!dayEntry.isActive) {
      return res.status(200).json({
        ...base, status: "closed",
        reason: "Clinic is closed on this day.",
        open: null, close: null,
        slotDuration: resolved.slotDuration,
        totalSlots: 0, breaks: [], slots: [],
      });
    }

    if (dayEntry.isDayLocked) {
      return res.status(200).json({
        ...base, status: "day_locked",
        reason: "This day is fully locked.",
        open: dayEntry.open, close: dayEntry.close,
        slotDuration: dayEntry.slotDuration ?? resolved.slotDuration,
        totalSlots: 0, breaks: dayEntry.breaks ?? [], slots: [],
      });
    }

    // ── 6. Resolve per-day slot settings ──────────────────────────────────────
    const slotDuration    = dayEntry.slotDuration    ?? resolved.slotDuration;
    const dailyCapacity   = dayEntry.dailyCapacity   ?? resolved.dailyCapacity;
    const patientsPerSlot = dayEntry.patientsPerSlot ?? resolved.patientsPerSlot;

    // ── 7. Generate raw slots ─────────────────────────────────────────────────
    const rawSlots = buildSlots({
      open: dayEntry.open,
      close: dayEntry.close,
      slotDuration,
      dailyCapacity,
      breaks: dayEntry.breaks ?? [],
    });

    // ── 8. ✅ Query booked appointments for this day ───────────────────────────
    const OCCUPYING_STATUSES = ["upcoming", "inProgress", "completed"];

    const bookedAgg = await Appointment.aggregate([
      {
        $match: {
          clinic: clinic._id,
          date:   requestedDate,          // UTC midnight — يتطابق مع bookAppointment
          status: { $in: OCCUPYING_STATUSES },
        },
      },
      {
        $group: {
          _id:   "$slotStart",
          count: { $sum: 1 },
        },
      },
    ]);

    // "09:00" → 2
    const bookedPerSlot = {};
    let totalBookedToday = 0;
    for (const entry of bookedAgg) {
      bookedPerSlot[entry._id] = entry.count;
      totalBookedToday += entry.count;
    }

    // ── 9. Annotate slots with real availability ───────────────────────────────
    const slots = rawSlots.map((slot) => {
      const bookedCount = bookedPerSlot[slot.startTime] ?? 0;
      const slotFull    = bookedCount >= patientsPerSlot;
      const dayFull     = totalBookedToday >= dailyCapacity;
      const isAvailable = !slotFull && !dayFull;

      return {
        ...slot,
        available:       isAvailable,
        bookedCount,
        patientsPerSlot,
        remainingInSlot: Math.max(0, patientsPerSlot - bookedCount),
        remainingInDay:  Math.max(0, dailyCapacity   - totalBookedToday),
        ...(isAvailable ? {} : {
          reason: slotFull ? "Slot is fully booked." : "Daily capacity reached.",
        }),
      };
    });

    // ── 10. Respond ───────────────────────────────────────────────────────────
    const status = dayEntry.isBookingLocked ? "booking_locked" : "open";

    return res.status(200).json({
      ...base,
      status,
      ...(dayEntry.isBookingLocked && { reason: "New bookings are locked for this day." }),
      open:            dayEntry.open,
      close:           dayEntry.close,
      slotDuration,
      dailyCapacity,
      patientsPerSlot,
      totalBookedToday,
      totalSlots:      slots.length,
      hasAppointments: totalBookedToday > 0,
      breaks: (dayEntry.breaks ?? []).map((b) => ({
        start: b.start, end: b.end, label: b.label ?? "",
      })),
      slots,
    });

  } catch (err) {
    console.error("getDaySlots error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};