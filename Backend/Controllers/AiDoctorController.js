// controllers/aiDoctorController.js
//
// AI-powered assistant for doctors — built on top of the rich context
// object assembled in aiContextController.js.
//
// Uses Azure OpenAI (gpt-4o) for brief + financial analysis.
// Uses Anthropic (claude-sonnet-4-6) for conversational chat — see aiContextController.js.
//
// Routes (wire these in your router):
//   GET  /api/ai/brief       → AI-generated daily briefing      (Azure)
//   GET  /api/ai/financials  → profit/loss analysis + predictions (Azure)
//
// Note: POST /api/ai/chat is handled in aiContextController.js

const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");

// ── Single source of truth for context ───────────────────────────────────────
const { getAIChatContext } = require("./DoctorContext");

// ─── Azure OpenAI client ──────────────────────────────────────────────────────

const openaiClient = new AzureOpenAI({
  endpoint: openAIEndpoint,
  apiKey: openAIKey,
  apiVersion: "2024-02-01",
  deployment: "gpt-4o",
});

// ─── Shared helper: call Azure and return parsed text or JSON ─────────────────

async function callAI({ systemPrompt, userPrompt, jsonMode = false, retries = 3 }) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const raw = result.choices[0].message.content || "";

      if (jsonMode) {
        const clean = raw.replace(/```json|```/g, "").trim();
        return JSON.parse(clean);
      }

      return raw.trim();
    } catch (err) {
      console.warn(`[aiDoctor] attempt ${attempt} failed:`, err.message);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── 1. AI-generated daily briefing ──────────────────────────────────────────

/**
 * GET /api/ai/brief
 *
 * Returns a polished, human-readable daily briefing for the doctor.
 *
 * Query params:
 *   lang  "ar" | "en"  (default: "ar")
 */
exports.aiDailyBrief = async (req, res) => {
  try {
    const lang = (req.query.lang || "ar").toLowerCase();

    // ── Fetch context from the single shared builder ──────────────────────
    const ctxResult = await getAIChatContext(req.user);
    if (!ctxResult.success) {
      return res.status(500).json({ message: ctxResult.error });
    }
    const ctx = ctxResult.data;

    const langInstruction =
      lang === "ar"
        ? "Write the briefing in clear, professional Arabic (Modern Standard Arabic). Use Arabic numerals (١٢٣...)."
        : "Write the briefing in clear, professional English.";

    const systemPrompt = `
You are a helpful medical practice assistant generating a concise daily briefing for a doctor.
${langInstruction}
Structure the briefing with these sections (use emoji icons as section headers):
📅 Today's Schedule
📊 This Week at a Glance
🏥 Clinic Status
💰 Financial Snapshot
⚠️  Action Items (only if there are pending clinics, no-shows, or overdue payments)
🌟 Motivational closing line

Keep the total under 300 words. Be warm but professional.
`.trim();

    const userPrompt = `
Here is the doctor's current data. Generate today's briefing.

Doctor: Dr. ${ctx.doctor.name} — ${ctx.doctor.specialization}
Rating: ${ctx.doctor.rating}/5 | Experience: ${ctx.doctor.yearsOfExperience} years

=== RAW CONTEXT ===
${ctx.briefing}

=== APPOINTMENTS ===
Today total: ${ctx.appointments.today.total}
Today status breakdown: ${JSON.stringify(ctx.appointments.today.byStatus)}
Today's list: ${JSON.stringify(ctx.appointments.today.list)}

This week: ${ctx.appointments.thisWeek.total} appointments
This month: ${ctx.appointments.thisMonth.total} appointments

=== CLINICS ===
${JSON.stringify(ctx.clinics, null, 2)}

=== FINANCIALS ===
${JSON.stringify(ctx.financials, null, 2)}

=== PATIENTS ===
${JSON.stringify(ctx.patients, null, 2)}
`.trim();

    const briefText = await callAI({ systemPrompt, userPrompt, jsonMode: false });

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      lang,
      brief: briefText,
    });
  } catch (err) {
    console.error("[aiDailyBrief] error:", err);
    return res.status(500).json({ message: "Internal server error.", error: err.message });
  }
};

// ─── 2. Financial analysis + profit/loss prediction ───────────────────────────

/**
 * GET /api/ai/financials
 *
 * Returns a structured JSON financial report with:
 *   - summary              : current month confirmed vs expected
 *   - profitLoss           : net after platform fees
 *   - perClinicBreakdown
 *   - trends               : growth/decline signals
 *   - predictions          : projected revenue for next 30 days
 *   - recommendations      : AI-generated action items to boost revenue
 *   - riskFlags            : warnings (high cancellation rate, pending clinics, etc.)
 *   - aiNarrative          : human-readable paragraph summary
 *
 * Query params:
 *   lang  "ar" | "en"  (default: "ar")
 */
exports.aiFinancialAnalysis = async (req, res) => {
  try {
    const lang = (req.query.lang || "ar").toLowerCase();

    // ── Fetch context from the single shared builder ──────────────────────
    const ctxResult = await getAIChatContext(req.user);
    if (!ctxResult.success) {
      return res.status(500).json({ message: ctxResult.error });
    }
    const ctx = ctxResult.data;

    const { financials, appointments, clinics, patients } = ctx;

    // ── Pre-compute extra signals for the AI ──────────────────────────────
    const cancellationRate =
      appointments.thisMonth.total > 0
        ? Math.round(
            ((appointments.thisMonth.byStatus?.cancelled || 0) /
              appointments.thisMonth.total) *
              100
          )
        : 0;

    const completionRate =
      appointments.thisMonth.total > 0
        ? Math.round(
            ((appointments.thisMonth.byStatus?.completed || 0) /
              appointments.thisMonth.total) *
              100
          )
        : 0;

    const avgRevenuePerAppointment =
      (appointments.thisMonth.byStatus?.completed || 0) > 0
        ? Math.round(
            financials.thisMonth.confirmedRevenue /
              (appointments.thisMonth.byStatus.completed || 1)
          )
        : 0;

    const pendingClinics = clinics.filter((c) => c.status === "pending");
    const approvedClinics = clinics.filter((c) => c.status === "approved");

    // ── Ask AI for structured financial analysis ───────────────────────────
    const systemPrompt = `
You are a financial analyst assistant for a medical practice management platform in Egypt.
Analyze the doctor's financial data and respond ONLY with a valid JSON object — no markdown, no preamble.

Required JSON structure:
{
  "summary": {
    "confirmedRevenue": number,
    "platformFee": number,
    "netRevenue": number,
    "expectedFromUpcoming": number,
    "totalProjected": number,
    "currency": "EGP"
  },
  "profitLoss": {
    "status": "profit" | "loss" | "break-even",
    "amount": number,
    "note": "string"
  },
  "perClinicBreakdown": [
    {
      "clinicName": "string",
      "completed": number,
      "upcoming": number,
      "estimatedRevenue": number,
      "shareOfTotal": "string (percentage)"
    }
  ],
  "trends": {
    "completionRate": number,
    "cancellationRate": number,
    "avgRevenuePerSession": number,
    "assessment": "string (1-2 sentences)"
  },
  "predictions": {
    "next30DaysEstimate": number,
    "basis": "string",
    "confidence": "low" | "medium" | "high"
  },
  "recommendations": ["string", "string", "string"],
  "riskFlags": ["string"],
  "aiNarrative": "string (2-3 sentences in ${lang === "ar" ? "Arabic" : "English"})"
}
`.trim();

    const userPrompt = `
Doctor: Dr. ${ctx.doctor.name} — ${ctx.doctor.specialization}

=== THIS MONTH ===
Confirmed revenue: ${financials.thisMonth.confirmedRevenue} EGP
Platform fee owed: ${financials.thisMonth.platformFeeOwed} EGP
Net revenue: ${financials.thisMonth.netRevenue} EGP
Expected from upcoming: ${financials.expectedFromUpcoming} EGP
Completion rate: ${completionRate}%
Cancellation rate: ${cancellationRate}%
Avg revenue per completed session: ${avgRevenuePerAppointment} EGP
Total appointments this month: ${appointments.thisMonth.total}
Completed: ${appointments.thisMonth.byStatus?.completed || 0}
Cancelled: ${appointments.thisMonth.byStatus?.cancelled || 0}
Upcoming: ${appointments.thisMonth.byStatus?.upcoming || 0}

=== CLINICS ===
Total clinics: ${clinics.length} (${approvedClinics.length} approved, ${pendingClinics.length} pending)
Per-clinic data:
${JSON.stringify(financials.perClinic || [], null, 2)}

=== PATIENTS ===
Total unique patients: ${patients.totalUnique}
No-shows: ${patients.noShowCount || 0}
All-time appointments: ${appointments.totalAllTime}

=== UPCOMING (next sessions) ===
${JSON.stringify(appointments.upcoming?.slice(0, 10) || [], null, 2)}
`.trim();

    const analysis = await callAI({ systemPrompt, userPrompt, jsonMode: true });

    if (!analysis || !analysis.summary || !analysis.predictions) {
      throw new Error("AI returned incomplete financial analysis.");
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      lang,
      analysis,
    });
  } catch (err) {
    console.error("[aiFinancialAnalysis] error:", err);
    return res.status(500).json({ message: "Internal server error.", error: err.message });
  }
};


exports.aiChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ message: "message (string) is required." });
    }

    const ctxResult = await getAIChatContext(req.user);
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

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const result = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages,
    });

    const reply = result.choices[0].message.content?.trim() || "No response.";

    return res.status(200).json({ reply, usage: result.usage || null });
  } catch (err) {
    console.error("[aiChat] error:", err);
    return res.status(500).json({ message: "Internal server error.", error: err.message });
  }
};