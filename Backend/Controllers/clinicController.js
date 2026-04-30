// controllers/clinicController.js
const Clinic = require("../Models/Clinic");
const Doctor = require("../Models/Doctors");

const timeToMins = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
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

const rangesOverlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

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

exports.createClinic = async (req, res) => {
  try {
    // ── 1. Get doctor from token ──────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    const doctorId = doctor._id;

    // ── 2. Validate body ──────────────────────────────────────────────────────
    const { name, city, address, location, price, operatingLicense, schedule } = req.body;

    if (!name || !city || !address || !location?.coordinates || price == null || !schedule) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const { slotDuration, dailyCapacity, patientsPerSlot = 1, days = [] } = schedule;

    if (!slotDuration || slotDuration < 5)   return res.status(400).json({ message: "slotDuration must be ≥ 5 minutes." });
    if (!dailyCapacity || dailyCapacity < 1) return res.status(400).json({ message: "dailyCapacity must be ≥ 1." });
    if (!days.length)                        return res.status(400).json({ message: "At least one working day is required." });

    // ── 3. Normalise & validate each day ─────────────────────────────────────
    const VALID_DAYS = ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"];

    const normalisedDays = days.map((d, i) => {
      if (!VALID_DAYS.includes(d.day)) {
        throw { status: 400, message: `Invalid day "${d.day}" at index ${i}.` };
      }
      const open  = typeof d.open  === "string" ? timeToMins(d.open)  : d.open;
      const close = typeof d.close === "string" ? timeToMins(d.close) : d.close;

      if (open >= close) {
        throw { status: 400, message: `${d.day}: open time must be before close time.` };
      }

      const breaks = (d.breaks || []).map((br) => {
        const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
        const bEnd   = typeof br.end   === "string" ? timeToMins(br.end)   : br.end;
        if (bStart < open || bEnd > close || bStart >= bEnd) {
          throw { status: 400, message: `${d.day}: break ${bStart}–${bEnd} is invalid.` };
        }
        return { start: bStart, end: bEnd, label: br.label || "" };
      });

      return {
        day:             d.day,
        isActive:        d.isActive !== false,
        open,
        close,
        breaks,
        slotDuration:    d.slotDuration    ?? null,
        dailyCapacity:   d.dailyCapacity   ?? null,
        patientsPerSlot: d.patientsPerSlot ?? null,
        isDayLocked:     d.isDayLocked     ?? false,
        isBookingLocked: d.isBookingLocked ?? false,
      };
    });

    // ── 4. No duplicate days ──────────────────────────────────────────────────
    const dayNames = normalisedDays.map((d) => d.day);
    if (new Set(dayNames).size !== dayNames.length) {
      return res.status(400).json({ message: "Duplicate days found in schedule." });
    }

    // ── 5. Overlap check across doctor's clinics ──────────────────────────────
    const activeDays = normalisedDays.filter((d) => d.isActive);
    const { conflict, message: conflictMsg } = await checkNoOverlapForDoctor(doctorId, activeDays);
    if (conflict) return res.status(409).json({ message: conflictMsg });

    // ── 6. Create clinic ──────────────────────────────────────────────────────
    const clinic = await Clinic.create({
      doctorId,
      name:     name.trim(),
      city:     city.trim(),
      address:  address.trim(),
      location: { type: "Point", coordinates: location.coordinates },
      price,
      operatingLicense: operatingLicense || "",
      defaultSchedule: {
        days: normalisedDays,
        slotDuration,
        dailyCapacity,
        patientsPerSlot,
      },
    });

    // ── 7. Push clinic ID into Doctor document ────────────────────────────────
    await Doctor.findByIdAndUpdate(doctorId, {
      $push: { clinics: clinic._id },
    });

    // ── 8. Build slots preview ────────────────────────────────────────────────
    const resolvedWeek = clinic.resolveWeek(new Date());
    const slotsPreview = resolveScheduleSlots({ ...resolvedWeek, slotDuration });

    return res.status(201).json({ message: "Clinic created successfully.", clinic, slotsPreview });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("createClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── ADD THIS to controllers/clinicController.js ───────────────────────────

exports.editClinic = async (req, res) => {
  try {
    // ── 1. Get doctor from token ──────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });
    const doctorId = doctor._id;

    // ── 2. Find clinic & verify ownership ────────────────────────────────────
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctorId.toString()) {
      return res.status(403).json({ message: "You are not authorized to edit this clinic." });
    }

    // ── 3. Extract fields from body (all optional) ────────────────────────────
    const { name, city, address, location, price, operatingLicense, schedule, status } = req.body;

    // ── 4. If schedule is being updated → validate it ─────────────────────────
    if (schedule) {
      const {
        slotDuration = clinic.defaultSchedule.slotDuration,
        dailyCapacity = clinic.defaultSchedule.dailyCapacity,
        patientsPerSlot = clinic.defaultSchedule.patientsPerSlot,
        days = [],
      } = schedule;

      if (slotDuration < 5)   return res.status(400).json({ message: "slotDuration must be ≥ 5 minutes." });
      if (dailyCapacity < 1)  return res.status(400).json({ message: "dailyCapacity must be ≥ 1." });
      if (!days.length)       return res.status(400).json({ message: "At least one working day is required." });

      const VALID_DAYS = ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"];

      const normalisedDays = days.map((d, i) => {
        if (!VALID_DAYS.includes(d.day)) {
          throw { status: 400, message: `Invalid day "${d.day}" at index ${i}.` };
        }
        const open  = typeof d.open  === "string" ? timeToMins(d.open)  : d.open;
        const close = typeof d.close === "string" ? timeToMins(d.close) : d.close;

        if (open >= close) {
          throw { status: 400, message: `${d.day}: open time must be before close time.` };
        }

        const breaks = (d.breaks || []).map((br) => {
          const bStart = typeof br.start === "string" ? timeToMins(br.start) : br.start;
          const bEnd   = typeof br.end   === "string" ? timeToMins(br.end)   : br.end;
          if (bStart < open || bEnd > close || bStart >= bEnd) {
            throw { status: 400, message: `${d.day}: break ${bStart}–${bEnd} is invalid.` };
          }
          return { start: bStart, end: bEnd, label: br.label || "" };
        });

        return {
          day:             d.day,
          isActive:        d.isActive !== false,
          open,
          close,
          breaks,
          slotDuration:    d.slotDuration    ?? null,
          dailyCapacity:   d.dailyCapacity   ?? null,
          patientsPerSlot: d.patientsPerSlot ?? null,
          isDayLocked:     d.isDayLocked     ?? false,
          isBookingLocked: d.isBookingLocked ?? false,
        };
      });

      // No duplicate days
      const dayNames = normalisedDays.map((d) => d.day);
      if (new Set(dayNames).size !== dayNames.length) {
        return res.status(400).json({ message: "Duplicate days found in schedule." });
      }

      // Overlap check — exclude THIS clinic from the check
      const activeDays = normalisedDays.filter((d) => d.isActive);
      const { conflict, message: conflictMsg } = await checkNoOverlapForDoctor(
        doctorId,
        activeDays,
        clinic._id   // ← excludeClinicId: skip comparing against itself
      );
      if (conflict) return res.status(409).json({ message: conflictMsg });

      // Apply schedule updates
      clinic.defaultSchedule.days           = normalisedDays;
      clinic.defaultSchedule.slotDuration   = slotDuration;
      clinic.defaultSchedule.dailyCapacity  = dailyCapacity;
      clinic.defaultSchedule.patientsPerSlot = patientsPerSlot;
    }

    // ── 5. Apply non-schedule field updates ───────────────────────────────────
    if (name)             clinic.name             = name.trim();
    if (city)             clinic.city             = city.trim();
    if (address)          clinic.address          = address.trim();
    if (price != null)    clinic.price            = price;
    if (operatingLicense !== undefined) clinic.operatingLicense = operatingLicense;
    if (status)           clinic.status           = status;
    if (location?.coordinates) {
      clinic.location = { type: "Point", coordinates: location.coordinates };
    }

    // ── 6. Save ───────────────────────────────────────────────────────────────
    await clinic.save();

    return res.status(200).json({ message: "Clinic updated successfully.", clinic });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("editClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── ADD THIS to controllers/clinicController.js ───────────────────────────

exports.getClinic = async (req, res) => {
  try {
    // ── 1. Get doctor from token ──────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    // ── 2. Find clinic ────────────────────────────────────────────────────────
    const clinic = await Clinic.findById(req.params.id).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });

    // ── 3. Verify ownership ───────────────────────────────────────────────────
    if (clinic.doctorId.toString() !== doctor._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to view this clinic." });
    }

    return res.status(200).json({ message: "Clinic fetched successfully.", clinic });

  } catch (err) {
    console.error("getClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};


// ─── ADD THIS to controllers/clinicController.js ───────────────────────────

exports.deleteClinic = async (req, res) => {
  try {
    // ── 1. Get doctor from token ──────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    // ── 2. Find clinic ────────────────────────────────────────────────────────
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });

    // ── 3. Verify ownership ───────────────────────────────────────────────────
    if (clinic.doctorId.toString() !== doctor._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to delete this clinic." });
    }

    // ── 4. Delete clinic ──────────────────────────────────────────────────────
    await clinic.deleteOne();

    // ── 5. Remove clinic ID from Doctor document ──────────────────────────────
    await Doctor.findByIdAndUpdate(doctor._id, {
      $pull: { clinics: clinic._id },
    });

    return res.status(200).json({ message: "Clinic deleted successfully." });

  } catch (err) {
    console.error("deleteClinic error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};


exports.overrideWeekSchedule = async (req, res) => {
  try {
    // ── 1. Doctor identity ──────────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user.id });
    if (!doctor) return res.status(403).json({ message: "Doctor profile not found." });

    // ── 2. Find clinic & verify ownership ──────────────────────────────────
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found." });
    if (clinic.doctorId.toString() !== doctor._id.toString())
      return res.status(403).json({ message: "Not authorized." });

    // ── 3. Parse & validate weekStart ───────────────────────────────────────
    const { weekStart, days = [] } = req.body;

    if (!weekStart) return res.status(400).json({ message: "weekStart is required." });

    const weekStartDate = new Date(weekStart);
    if (isNaN(weekStartDate.getTime()))
      return res.status(400).json({ message: "Invalid weekStart date." });

    // نضمن إن weekStart دايماً أول الأسبوع (السبت عندك)
    // لو مش محتاج enforce ده حذفه
    const DAY_OF_WEEK = weekStartDate.getDay(); // 0=Sun,6=Sat
    // اختياري: enforce Saturday as week start
    // if (DAY_OF_WEEK !== 6) return res.status(400).json({ message: "weekStart must be a Saturday." });

    // مش لازم يبعت أيام لو عايز يمسح override موجود (راجع step 7)
    if (!Array.isArray(days))
      return res.status(400).json({ message: "days must be an array." });

    // ── 4. Validate & normalise submitted days ──────────────────────────────
    const VALID_DAYS = ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"];
    const defaultDays = clinic.defaultSchedule.days;

    const normalisedOverrideDays = days.map((d, i) => {
      if (!VALID_DAYS.includes(d.day))
        throw { status: 400, message: `Invalid day "${d.day}" at index ${i}.` };

      // إيجاد اليوم في الـ default عشان نكمل القيم الناقصة
      const defDay = defaultDays.find((dd) => dd.day === d.day);

      // open/close: ممكن يبعتهم string "HH:MM" أو number (minutes)
      const open  = d.open  != null ? (typeof d.open  === "string" ? timeToMins(d.open)  : d.open)
                                    : defDay?.open;
      const close = d.close != null ? (typeof d.close === "string" ? timeToMins(d.close) : d.close)
                                    : defDay?.close;

      if (open == null || close == null)
        throw { status: 400, message: `${d.day}: open and close are required (no default found).` };

      if (open >= close)
        throw { status: 400, message: `${d.day}: open must be before close.` };

      // Breaks: لو بعت breaks جديدة بترجع الـ array الجديدة، لو مش بعت تاخد من الـ default
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
        day:             d.day,
        isActive:        d.isActive        ?? defDay?.isActive        ?? true,
        open,
        close,
        breaks,
        slotDuration:    d.slotDuration    ?? defDay?.slotDuration    ?? null,
        dailyCapacity:   d.dailyCapacity   ?? defDay?.dailyCapacity   ?? null,
        patientsPerSlot: d.patientsPerSlot ?? defDay?.patientsPerSlot ?? null,
        isDayLocked:     d.isDayLocked     ?? defDay?.isDayLocked     ?? false,
        isBookingLocked: d.isBookingLocked ?? defDay?.isBookingLocked ?? false,
      };
    });

    // ── 5. No duplicate days in the submitted patch ─────────────────────────
    const dayNames = normalisedOverrideDays.map((d) => d.day);
    if (new Set(dayNames).size !== dayNames.length)
      return res.status(400).json({ message: "Duplicate days in request." });

    // ── 6. Upsert weeklyOverrides entry ─────────────────────────────────────
    // لو في override قديم لنفس الأسبوع → نعمل merge معاه (مش نبدله كله)
    // ده بيخلي endpoint ده safe للـ partial update بردو
    const existingOverrideIdx = clinic.weeklyOverrides.findIndex(
      (o) => o.weekStart.toISOString() === weekStartDate.toISOString()
    );

    if (existingOverrideIdx === -1) {
      // مفيش override لأسبوع ده → أضف جديد
      clinic.weeklyOverrides.push({
        weekStart: weekStartDate,
        days: normalisedOverrideDays,
        // level-override fields (اختياري يبعتهم)
        slotDuration:    req.body.slotDuration    ?? null,
        dailyCapacity:   req.body.dailyCapacity   ?? null,
        patientsPerSlot: req.body.patientsPerSlot ?? null,
      });
    } else {
      // في override موجود → نعمل merge على مستوى الأيام
      const existing = clinic.weeklyOverrides[existingOverrideIdx];

      for (const newDay of normalisedOverrideDays) {
        const idx = existing.days.findIndex((d) => d.day === newDay.day);
        if (idx === -1) {
          existing.days.push(newDay);        // يوم جديد
        } else {
          existing.days[idx] = newDay;       // تحديث يوم موجود
        }
      }

      // level-override fields لو بعتهم
      if (req.body.slotDuration    != null) existing.slotDuration    = req.body.slotDuration;
      if (req.body.dailyCapacity   != null) existing.dailyCapacity   = req.body.dailyCapacity;
      if (req.body.patientsPerSlot != null) existing.patientsPerSlot = req.body.patientsPerSlot;
    }

    await clinic.save();

    // ── 7. Return resolved week so frontend can preview ─────────────────────
    const resolvedWeek = clinic.resolveWeek(weekStartDate);
    const slotsPreview = resolveScheduleSlots(resolvedWeek);

    return res.status(200).json({
      message:      "Week schedule overridden successfully.",
      weekStart:    weekStartDate,
      resolvedWeek,
      slotsPreview,
    });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("overrideWeekSchedule error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * DELETE /clinics/:id/schedule/override
 * Body: { weekStart: "2025-07-14" }
 *
 * لمسح override كامل لأسبوع → يرجع للـ default
 */
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