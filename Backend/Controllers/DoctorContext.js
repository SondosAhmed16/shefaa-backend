// controllers/aiContextController.js
//
// Builds a rich context object for the AI assistant so it can answer
// any question the doctor has about their clinics, appointments,
// patients, schedule, and financials.
//
// Routes:
//   GET  /api/ai/context   → full context JSON (HTTP handler)
//   POST /api/ai/chat      → conversational assistant (Anthropic)
//
// Internal export:
//   getAIChatContext(user) → used by aiDoctorController.js directly

const Doctor = require("../Models/Doctors");
const Clinic = require("../Models/Clinic");
const Appointment = require("../Models/Appointment");
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
  const dayOfWeek = today.getUTCDay();
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

const countByStatus = (apps) =>
  apps.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

// ─── Core context builder (shared by HTTP handler + internal callers) ─────────

/**
 * buildContextForDoctor(user)
 *
 * Returns { success: true, data: { doctor, clinics, appointments, patients, financials, briefing } }
 * or      { success: false, error: string }
 *
 * This is the single source of truth — used by both the HTTP /api/ai/context
 * endpoint and by aiDoctorController.js (aiChat, aiDailyBrief, aiFinancialAnalysis).
 */
async function buildContextForDoctor(user) {
  try {
    // ── 1. Doctor profile ─────────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId: user._id })
      .populate("userId", "name email phone")
      .lean();

    if (!doctor) return { success: false, error: "Doctor profile not found." };

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
        status: c.status,
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
      recentActivity: allAppointments.slice(0, 10).map((a) => ({
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
      })),
      totalAllTime: allAppointments.length,
    };

    // ── 4. Patients summary ───────────────────────────────────────────────
    const uniquePatientIds = [
      ...new Set(
        allAppointments
          .filter((a) => a.patient?._id)
          .map((a) => a.patient._id.toString())
      ),
    ];

    const patientVisitCount = allAppointments.reduce((acc, a) => {
      const pid = a.patient?._id?.toString();
      if (pid) {
        if (!acc[pid]) acc[pid] = { count: 0, name: a.patient?.userId?.name || "Unknown" };
        acc[pid].count += 1;
      }
      return acc;
    }, {});

    const frequentPatients = Object.entries(patientVisitCount)
      .filter(([, v]) => v.count >= 3)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([id, v]) => ({ patientId: id, name: v.name, visits: v.count }));

    const patientsContext = {
      totalUnique: uniquePatientIds.length,
      frequentPatients,
      cancelledAppointments: allAppointments.filter((a) => a.status === "cancelled").length,
      noShowCount: allAppointments.filter((a) => a.status === "no-show").length,
    };

    // ── 5. Financials ─────────────────────────────────────────────────────
    const PLATFORM_FEE_RATE = 0.015;

    let monthlyRevenue = 0;
    let monthlyPlatformFee = 0;
    let monthlyTransactionCount = 0;

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
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            totalFee: { $sum: "$platformFeeAmount" },
            count: { $sum: 1 },
          },
        },
      ]);
      if (agg) {
        monthlyRevenue = parseFloat(agg.totalRevenue.toFixed(2));
        monthlyPlatformFee = parseFloat(agg.totalFee.toFixed(2));
        monthlyTransactionCount = agg.count;
      }
    } catch (_) {
      // Non-blocking — Transaction model may not exist in all environments
    }

    const revenuePerClinic = clinics.map((c) => {
      const clinicApps = monthApps.filter(
        (a) => a.clinic?._id?.toString() === c._id.toString()
      );
      return {
        clinicId: c._id,
        clinicName: c.name,
        totalAppointments: clinicApps.length,
        completed: clinicApps.filter((a) => a.status === "completed").length,
        upcoming: clinicApps.filter((a) => a.status === "upcoming").length,
        pricePerSession: c.price,
        estimatedMonthlyRevenue: clinicApps.length * (c.price || 0),
      };
    });

    const expectedRevenue = upcomingApps.reduce(
      (sum, a) => sum + (a.clinic?.price || 0),
      0
    );

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

    // ── 6. Daily briefing text ────────────────────────────────────────────
    const pendingClinics = clinicsContext.filter((c) => c.status === "pending");
    const approvedClinics = clinicsContext.filter((c) => c.status === "approved");

    const briefing = [
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

    return {
      success: true,
      data: {
        doctor: doctorContext,
        clinics: clinicsContext,
        appointments: appointmentsContext,
        patients: patientsContext,
        financials: financialsContext,
        briefing,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Internal export — used directly by aiDoctorController.js ────────────────
exports.getAIChatContext = buildContextForDoctor;

// ─── HTTP handler: GET /api/ai/context ───────────────────────────────────────

exports.getAIContext = async (req, res) => {
  try {
    const result = await buildContextForDoctor(req.user);

    if (!result.success) {
      return res.status(result.error === "Doctor profile not found." ? 404 : 500)
        .json({ message: result.error });
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      ...result.data,
    });
  } catch (err) {
    console.error("getAIContext error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── HTTP handler: POST /api/ai/chat (Anthropic) ─────────────────────────────

/**
 * POST /api/ai/chat
 *
 * Body:
 *   message  {string}  – the doctor's question (Arabic or English)
 *   history  {Array}   – optional prior turns
 *              [{ role: "user"|"assistant", content: string }]
 */
exports.aiChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ message: "message (string) is required." });
    }

    const ctxResult = await buildContextForDoctor(req.user);
    if (!ctxResult.success) {
      return res.status(500).json({ message: ctxResult.error });
    }
    const ctx = ctxResult.data;

    const systemPrompt = `
You are an intelligent AI assistant embedded in Chefaa, a medical appointment platform in Egypt.
You are speaking directly with Dr. ${ctx.doctor.name}, a ${ctx.doctor.specialization} specialist.

RULES:
- Answer ONLY in the same language the doctor uses (Arabic or English).
- Be concise, professional, and friendly.
- Do NOT invent numbers or facts — use ONLY the context provided below.
- If the doctor asks about something not covered by the context, say so politely.

=== DAILY BRIEFING ===
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
      console.error("[aiChat] Anthropic API error:", errText);
      return res.status(502).json({ message: "AI service error.", detail: errText });
    }

    const aiData = await anthropicRes.json();
    const reply =
      aiData.content?.map((c) => c.text || "").join("") || "No response from AI.";

    return res.status(200).json({ reply, usage: aiData.usage || null });
  } catch (err) {
    console.error("[aiChat] error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.getAIChatContext = buildContextForDoctor;