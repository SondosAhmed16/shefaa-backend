// controllers/aiContextController.js
//
// Builds a rich context object for the AI assistant so it can answer
// any question the doctor has about their clinics, appointments,
// patients, schedule, and financials.
//
// Route (example):
//   GET /api/ai/context          → full context (used to prime the AI)
//   POST /api/ai/chat            → send a message + context to Claude

const Doctor = require("../Models/Doctors");
const Clinic = require("../Models/Clinic");
const Appointment = require("../Models/Appointment");
const Patient = require("../Models/Patients");
const Transaction = require("../Models/Transaction");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const minsToTime = (mins) => {
  if (mins == null) return null;
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
};

const getTodayUTC = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const getWeekBounds = () => {
  const today = getTodayUTC();
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - dayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
  return { weekStart, weekEnd };
};

const getMonthBounds = () => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { monthStart, monthEnd };
};

// ─── Main context builder ──────────────────────────────────────────────────────

/**
 * GET /api/ai/context
 *
 * Returns a structured JSON object the frontend passes as the system
 * prompt / context to the AI assistant.
 *
 * Sections returned:
 *   doctor        – profile, specialization, rating
 *   clinics       – each clinic with schedule summary
 *   appointments  – today / this week / upcoming / recent
 *   patients      – summary of unique patients seen
 *   financials    – this month's revenue, fee owed, per-clinic breakdown
 *   briefing      – pre-built natural-language daily briefing string
 */
exports.getAIContext = async (req, res) => {
  try {
    // ── 1. Doctor profile ─────────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: req.user._id })
      .populate("userId", "name email phone")
      .lean();

    if (!doctor) {
      return res.status(404).json({ message: "Doctor profile not found." });
    }

    const doctorContext = {
      name: doctor.userId?.name || "Unknown",
      email: doctor.userId?.email,
      phone: doctor.userId?.phone,
      contactNumber: doctor.contactNumber,
      specialization: doctor.specialization,
      yearsOfExperience: doctor.yearsOfExperience,
      rating: doctor.rating,
      gender: doctor.gender,
      about: doctor.about,
      degrees: doctor.degrees || [],
      clinicConsultationPrice: doctor.clinicConsultationPrice,
      paymentOption: doctor.paymentOption,
    };

    // ── 2. Clinics ────────────────────────────────────────────────────────
    const clinics = await Clinic.find({ doctorId: doctor._id }).lean();

    const clinicsContext = clinics.map((c) => {
      const workingDays = (c.defaultSchedule?.days || [])
        .filter((d) => d.isActive && !d.isDayLocked)
        .map((d) => ({
          day: d.day,
          hours: `${minsToTime(d.open)} – ${minsToTime(d.close)}`,
          slotDuration: d.slotDuration ?? c.defaultSchedule?.slotDuration,
          dailyCapacity: d.dailyCapacity ?? c.defaultSchedule?.dailyCapacity,
          breaks: (d.breaks || []).map((b) => ({
            from: minsToTime(b.start),
            to: minsToTime(b.end),
            label: b.label || "",
          })),
        }));

      return {
        id: c._id,
        name: c.name,
        city: c.city,
        address: c.address,
        price: c.price,
        status: c.status,         // pending / approved / rejected
        workingDays,
        slotDuration: c.defaultSchedule?.slotDuration,
        dailyCapacity: c.defaultSchedule?.dailyCapacity,
        patientsPerSlot: c.defaultSchedule?.patientsPerSlot,
      };
    });

    // ── 3. Appointments ───────────────────────────────────────────────────
    const today = getTodayUTC();
    const { weekStart, weekEnd } = getWeekBounds();
    const { monthStart, monthEnd } = getMonthBounds();

    const allAppointments = await Appointment.find({ doctor: doctor._id })
      .populate({
        path: "patient",
        select: "userId age gender bloodType chronicConditions",
        populate: { path: "userId", select: "name phone email" },
      })
      .populate("clinic", "name city price")
      .sort({ date: -1 })
      .lean();

    // Today
    const todayApps = allAppointments.filter(
      (a) => new Date(a.date).getTime() === today.getTime()
    );

    // This week
    const weekApps = allAppointments.filter((a) => {
      const d = new Date(a.date);
      return d >= weekStart && d < weekEnd;
    });

    // This month
    const monthApps = allAppointments.filter((a) => {
      const d = new Date(a.date);
      return d >= monthStart && d < monthEnd;
    });

    // Upcoming (future, not cancelled)
    const upcomingApps = allAppointments.filter(
      (a) =>
        new Date(a.date) >= today &&
        !["cancelled", "completed"].includes(a.status)
    );

    // Recent 10 (for activity feed)
    const recentApps = allAppointments.slice(0, 10).map((a) => ({
      id: a._id,
      patientName: a.patient?.userId?.name || "Unknown",
      clinicName: a.clinic?.name || "Unknown",
      date: a.date,
      slotStart: a.slotStart,
      slotEnd: a.slotEnd,
      status: a.status,
      paymentStatus: a.paymentStatus,
      paymentOption: a.paymentOption,
      isFollowUp: a.isFollowUp,
    }));

    // Status breakdown helpers
    const countByStatus = (apps) =>
      apps.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {});

    const appointmentsContext = {
      today: {
        date: today.toISOString().slice(0, 10),
        total: todayApps.length,
        byStatus: countByStatus(todayApps),
        list: todayApps.map((a) => ({
          id: a._id,
          patientName: a.patient?.userId?.name || "Unknown",
          clinicName: a.clinic?.name,
          slotStart: a.slotStart,
          slotEnd: a.slotEnd,
          status: a.status,
          paymentStatus: a.paymentStatus,
          isFollowUp: a.isFollowUp,
        })),
      },
      thisWeek: {
        total: weekApps.length,
        byStatus: countByStatus(weekApps),
        completedCount: weekApps.filter((a) => a.status === "completed").length,
        cancelledCount: weekApps.filter((a) => a.status === "cancelled").length,
        upcomingCount: weekApps.filter((a) => a.status === "upcoming").length,
      },
      thisMonth: {
        total: monthApps.length,
        byStatus: countByStatus(monthApps),
        completionRate:
          monthApps.length > 0
            ? Math.round(
                (monthApps.filter((a) => a.status === "completed").length /
                  monthApps.length) *
                  100
              )
            : 0,
      },
      upcoming: upcomingApps.slice(0, 20).map((a) => ({
        id: a._id,
        patientName: a.patient?.userId?.name || "Unknown",
        clinicName: a.clinic?.name,
        date: new Date(a.date).toISOString().slice(0, 10),
        slotStart: a.slotStart,
        status: a.status,
        paymentOption: a.paymentOption,
        paymentStatus: a.paymentStatus,
      })),
      recentActivity: recentApps,
      totalAllTime: allAppointments.length,
    };

    // ── 4. Patients summary ───────────────────────────────────────────────
    // Unique patients seen by this doctor
    const uniquePatientIds = [
      ...new Set(
        allAppointments
          .filter((a) => a.patient?._id)
          .map((a) => a.patient._id.toString())
      ),
    ];

    // Frequent patients (≥ 3 visits)
    const patientVisitCount = allAppointments.reduce((acc, a) => {
      const pid = a.patient?._id?.toString();
      if (pid) acc[pid] = (acc[pid] || { count: 0, name: a.patient?.userId?.name || "Unknown" });
      if (pid) acc[pid].count += 1;
      return acc;
    }, {});

    const frequentPatients = Object.entries(patientVisitCount)
      .filter(([, v]) => v.count >= 3)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([id, v]) => ({ patientId: id, name: v.name, visits: v.count }));

    // No-show / cancelled patients
    const cancelledByPatient = allAppointments.filter(
      (a) => a.status === "cancelled"
    );
    const noShowPatients = allAppointments.filter(
      (a) => a.status === "no-show"
    );

    const patientsContext = {
      totalUnique: uniquePatientIds.length,
      frequentPatients,
      cancelledAppointments: cancelledByPatient.length,
      noShowCount: noShowPatients.length,
    };

    // ── 5. Financials ─────────────────────────────────────────────────────
    const PLATFORM_FEE_RATE = 0.015;

    // Revenue from completed transactions this month
    let monthlyRevenue = 0;
    let monthlyPlatformFee = 0;
    let monthlyTransactionCount = 0;

    try {
      const pipeline = [
        {
          $match: {
            recipient: req.user._id,
            status: "completed",
            type: "appointment_fee",
            createdAt: { $gte: monthStart, $lt: monthEnd },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            totalFee: { $sum: "$platformFeeAmount" },
            count: { $sum: 1 },
          },
        },
      ];

      const [agg] = await Transaction.aggregate(pipeline);
      if (agg) {
        monthlyRevenue = parseFloat(agg.totalRevenue.toFixed(2));
        monthlyPlatformFee = parseFloat(agg.totalFee.toFixed(2));
        monthlyTransactionCount = agg.count;
      }
    } catch (_) {
      // Transaction model might not exist in all environments — non-blocking
    }

    // Per-clinic revenue estimate from upcoming paid appointments
    const revenuePerClinic = clinics.map((c) => {
      const clinicApps = monthApps.filter(
        (a) => a.clinic?._id?.toString() === c._id.toString()
      );
      const completedCount = clinicApps.filter(
        (a) => a.status === "completed"
      ).length;
      const upcomingCount = clinicApps.filter(
        (a) => a.status === "upcoming"
      ).length;
      const estimatedRevenue = clinicApps.length * (c.price || 0);

      return {
        clinicId: c._id,
        clinicName: c.name,
        totalAppointments: clinicApps.length,
        completed: completedCount,
        upcoming: upcomingCount,
        pricePerSession: c.price,
        estimatedMonthlyRevenue: estimatedRevenue,
      };
    });

    // Expected revenue from all upcoming appointments
    const expectedRevenue = upcomingApps.reduce((sum, a) => {
      const price = a.clinic?.price || 0;
      return sum + price;
    }, 0);

    const financialsContext = {
      thisMonth: {
        confirmedRevenue: monthlyRevenue,
        platformFeeOwed: monthlyPlatformFee,
        netRevenue: parseFloat((monthlyRevenue - monthlyPlatformFee).toFixed(2)),
        paidAppointments: monthlyTransactionCount,
        feeRate: `${(PLATFORM_FEE_RATE * 100).toFixed(1)}%`,
      },
      expectedFromUpcoming: parseFloat(expectedRevenue.toFixed(2)),
      perClinic: revenuePerClinic,
      currency: "EGP",
    };

    // ── 6. Daily briefing (pre-built text for the AI) ─────────────────────
    const pendingClinics = clinicsContext.filter((c) => c.status === "pending");
    const approvedClinics = clinicsContext.filter((c) => c.status === "approved");

    const briefingLines = [
      `Doctor: Dr. ${doctorContext.name} — ${doctorContext.specialization}`,
      `Today (${today.toISOString().slice(0, 10)}): ${appointmentsContext.today.total} appointment(s) — ${appointmentsContext.today.byStatus.completed || 0} completed, ${appointmentsContext.today.byStatus.upcoming || 0} upcoming, ${appointmentsContext.today.byStatus.cancelled || 0} cancelled.`,
      `This week: ${appointmentsContext.thisWeek.total} appointments (${appointmentsContext.thisWeek.completedCount} done, ${appointmentsContext.thisWeek.cancelledCount} cancelled).`,
      `This month: ${appointmentsContext.thisMonth.total} appointments — ${appointmentsContext.thisMonth.completionRate}% completion rate.`,
      `Clinics: ${clinicsContext.length} total — ${approvedClinics.length} approved, ${pendingClinics.length} pending approval.`,
      pendingClinics.length > 0
        ? `⚠️ Pending clinics needing follow-up: ${pendingClinics.map((c) => c.name).join(", ")}.`
        : "",
      `Total unique patients: ${patientsContext.totalUnique}. No-shows: ${patientsContext.noShowCount}. Cancellations: ${patientsContext.cancelledAppointments}.`,
      `Financials — confirmed revenue this month: ${financialsContext.thisMonth.confirmedRevenue} EGP. Expected from upcoming: ${financialsContext.expectedFromUpcoming} EGP. Platform fee owed: ${financialsContext.thisMonth.platformFeeOwed} EGP.`,
      `Rating: ${doctorContext.rating}/5.`,
    ]
      .filter(Boolean)
      .join("\n");

    // ── 7. Response ───────────────────────────────────────────────────────
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      doctor: doctorContext,
      clinics: clinicsContext,
      appointments: appointmentsContext,
      patients: patientsContext,
      financials: financialsContext,
      briefing: briefingLines,
    });
  } catch (err) {
    console.error("getAIContext error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── AI Chat endpoint ─────────────────────────────────────────────────────────

/**
 * POST /api/ai/chat
 *
 * Body:
 *   message   {string}  – the doctor's question
 *   history   {Array}   – optional prior conversation turns
 *               [{ role: "user"|"assistant", content: string }]
 *
 * Fetches fresh context, builds the system prompt, then proxies to
 * the Anthropic messages API and streams back the reply.
 *
 * ⚠️  Set ANTHROPIC_API_KEY in your .env file.
 */
exports.aiChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ message: "message (string) is required." });
    }

    // ── Build fresh context ────────────────────────────────────────────────
    // Re-use the same logic above but call it internally
    const contextRes = await buildContextForDoctor(req.user);
    if (!contextRes.success) {
      return res.status(500).json({ message: contextRes.error });
    }

    const ctx = contextRes.data;

    // ── System prompt ──────────────────────────────────────────────────────
    const systemPrompt = `
You are an intelligent AI assistant embedded in Chefaa, a medical appointment platform in Egypt.
You are speaking directly with Dr. ${ctx.doctor.name}, a ${ctx.doctor.specialization} doctor.
Answer ONLY in the same language the doctor uses (Arabic or English).
Be concise, helpful, and medically professional. Do not make up data — use only what is provided below.

=== CLINIC CONTEXT ===
${ctx.briefing}

=== FULL CONTEXT (JSON) ===
${JSON.stringify(
  {
    doctor: ctx.doctor,
    clinics: ctx.clinics,
    appointments: ctx.appointments,
    patients: ctx.patients,
    financials: ctx.financials,
  },
  null,
  2
)}
`.trim();

    // ── Call Anthropic API ─────────────────────────────────────────────────
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ message: "ANTHROPIC_API_KEY is not configured." });
    }

    const messages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ message: "AI service error.", detail: errText });
    }

    const aiData = await anthropicRes.json();
    const reply =
      aiData.content?.map((c) => c.text || "").join("") ||
      "No response from AI.";

    return res.status(200).json({
      reply,
      usage: aiData.usage || null,
    });
  } catch (err) {
    console.error("aiChat error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── Internal helper (reused by aiChat) ──────────────────────────────────────

async function buildContextForDoctor(user) {
  try {
    const doctor = await Doctor.findOne({ userId: user._id })
      .populate("userId", "name email phone")
      .lean();

    if (!doctor) return { success: false, error: "Doctor not found." };

    const today = getTodayUTC();
    const { weekStart, weekEnd } = getWeekBounds();
    const { monthStart, monthEnd } = getMonthBounds();

    const [clinics, allAppointments] = await Promise.all([
      Clinic.find({ doctorId: doctor._id }).lean(),
      Appointment.find({ doctor: doctor._id })
        .populate({
          path: "patient",
          select: "userId age gender",
          populate: { path: "userId", select: "name phone" },
        })
        .populate("clinic", "name city price")
        .sort({ date: -1 })
        .lean(),
    ]);

    const todayApps = allAppointments.filter(
      (a) => new Date(a.date).getTime() === today.getTime()
    );
    const weekApps = allAppointments.filter((a) => {
      const d = new Date(a.date);
      return d >= weekStart && d < weekEnd;
    });
    const monthApps = allAppointments.filter((a) => {
      const d = new Date(a.date);
      return d >= monthStart && d < monthEnd;
    });
    const upcomingApps = allAppointments.filter(
      (a) =>
        new Date(a.date) >= today &&
        !["cancelled", "completed"].includes(a.status)
    );

    const countByStatus = (apps) =>
      apps.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {});

    const clinicsContext = clinics.map((c) => ({
      id: c._id,
      name: c.name,
      city: c.city,
      address: c.address,
      price: c.price,
      status: c.status,
      workingDays: (c.defaultSchedule?.days || [])
        .filter((d) => d.isActive)
        .map((d) => ({
          day: d.day,
          hours: `${minsToTime(d.open)} – ${minsToTime(d.close)}`,
        })),
    }));

    const pendingClinics = clinicsContext.filter((c) => c.status === "pending");
    const approvedClinics = clinicsContext.filter((c) => c.status === "approved");

    const uniquePatients = new Set(
      allAppointments.map((a) => a.patient?._id?.toString()).filter(Boolean)
    ).size;

    // Quick financials
    let monthlyRevenue = 0;
    try {
      const [agg] = await Transaction.aggregate([
        {
          $match: {
            recipient: user._id,
            status: "completed",
            type: "appointment_fee",
            createdAt: { $gte: monthStart, $lt: monthEnd },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      monthlyRevenue = agg?.total || 0;
    } catch (_) {}

    const expectedRevenue = upcomingApps.reduce(
      (sum, a) => sum + (a.clinic?.price || 0),
      0
    );

    const briefingLines = [
      `Doctor: Dr. ${doctor.userId?.name} — ${doctor.specialization}`,
      `Today (${today.toISOString().slice(0, 10)}): ${todayApps.length} appointment(s) — ${todayApps.filter(a => a.status === "completed").length} completed, ${todayApps.filter(a => a.status === "upcoming").length} upcoming.`,
      `This week: ${weekApps.length} appointments (${weekApps.filter(a => a.status === "completed").length} done).`,
      `This month: ${monthApps.length} appointments.`,
      `Clinics: ${clinics.length} total — ${approvedClinics.length} approved, ${pendingClinics.length} pending.`,
      pendingClinics.length > 0 ? `Pending clinics: ${pendingClinics.map(c => c.name).join(", ")}.` : "",
      `Total unique patients: ${uniquePatients}. Upcoming appointments: ${upcomingApps.length}.`,
      `Revenue this month: ${monthlyRevenue} EGP confirmed. Expected from upcoming: ${expectedRevenue} EGP.`,
      `Rating: ${doctor.rating}/5.`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: true,
      data: {
        doctor: {
          name: doctor.userId?.name,
          specialization: doctor.specialization,
          rating: doctor.rating,
          yearsOfExperience: doctor.yearsOfExperience,
        },
        clinics: clinicsContext,
        appointments: {
          today: { total: todayApps.length, byStatus: countByStatus(todayApps), list: todayApps.map(a => ({ patientName: a.patient?.userId?.name, slot: a.slotStart, status: a.status, clinic: a.clinic?.name })) },
          thisWeek: { total: weekApps.length, byStatus: countByStatus(weekApps) },
          thisMonth: { total: monthApps.length, byStatus: countByStatus(monthApps) },
          upcoming: upcomingApps.slice(0, 15).map(a => ({ patientName: a.patient?.userId?.name, date: new Date(a.date).toISOString().slice(0, 10), slot: a.slotStart, clinic: a.clinic?.name })),
          totalAllTime: allAppointments.length,
        },
        patients: { totalUnique: uniquePatients },
        financials: {
          confirmedRevenueThisMonth: monthlyRevenue,
          expectedFromUpcoming: expectedRevenue,
          currency: "EGP",
        },
        briefing: briefingLines,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}