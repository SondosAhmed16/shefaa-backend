// Controllers/pharmacyFinanceAI.js

const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");
const Pharmacy = require("../Models/Pharmaces");
const Order = require("../Models/Order");
const MonthlyPayment = require("../Models/MonthlyPayment");

const openaiClient = new AzureOpenAI({
  endpoint: openAIEndpoint,
  apiKey: openAIKey,
  apiVersion: "2024-02-01",
  deployment: "gpt-4o",
});

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

const getPharmacy = (userId) => Pharmacy.findOne({ userId });

function groupByDay(orders) {
  const map = {};
  for (const o of orders) {
    const day = new Date(o.createdAt).toISOString().slice(0, 10);
    if (!map[day]) map[day] = { date: day, revenue: 0, commission: 0, netEarnings: 0, orders: 0, cancelled: 0 };
    if (o.status === "Completed") {
      map[day].revenue     += o.totalPrice      || 0;
      map[day].commission  += o.commissionAmount || 0;
      map[day].netEarnings += o.pharmacyEarning  || 0;
      map[day].orders      += 1;
    }
    if (o.status === "Cancelled") map[day].cancelled += 1;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function groupByWeek(orders) {
  const map = {};
  for (const o of orders) {
    const d    = new Date(o.createdAt);
    const day  = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const week = monday.toISOString().slice(0, 10);
    if (!map[week]) map[week] = { weekStart: week, revenue: 0, commission: 0, netEarnings: 0, orders: 0, cancelled: 0 };
    if (o.status === "Completed") {
      map[week].revenue     += o.totalPrice      || 0;
      map[week].commission  += o.commissionAmount || 0;
      map[week].netEarnings += o.pharmacyEarning  || 0;
      map[week].orders      += 1;
    }
    if (o.status === "Cancelled") map[week].cancelled += 1;
  }
  return Object.values(map).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function paymentMethodBreakdown(orders) {
  const map = {};
  for (const o of orders.filter(o => o.status === "Completed")) {
    const m = o.paymentMethod || "Unknown";
    if (!map[m]) map[m] = { method: m, count: 0, revenue: 0 };
    map[m].count   += 1;
    map[m].revenue += o.totalPrice || 0;
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function orderTypeBreakdown(orders) {
  const map = {};
  for (const o of orders.filter(o => o.status === "Completed")) {
    const t = o.orderType || "Unknown";
    if (!map[t]) map[t] = { type: t, count: 0, revenue: 0 };
    map[t].count   += 1;
    map[t].revenue += o.totalPrice || 0;
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function topSellingItems(orders) {
  const map = {};
  for (const o of orders.filter(o => o.status === "Completed")) {
    for (const item of (o.items || [])) {
      const id = item.medicineId?.toString() || "unknown";
      if (!map[id]) map[id] = { medicineId: id, quantity: 0, revenue: 0 };
      map[id].quantity += item.quantity || 0;
      map[id].revenue  += (item.price || 0) * (item.quantity || 0);
    }
  }
  return Object.values(map)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN CONTROLLER
// GET /api/pharmacy/finance/report?year=2025&month=6
// ════════════════════════════════════════════════════════════════════════════

exports.getFinanceReport = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user._id || req.user.id);
    if (!pharmacy) return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const pharmacyId = pharmacy._id;

    // ── Determine requested period ────────────────────────────────────
    const now        = new Date();
    const year       = parseInt(req.query.year  || now.getFullYear(),  10);
    const month      = parseInt(req.query.month || now.getMonth() + 1, 10);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 1);

    // ── Previous month for comparison ─────────────────────────────────
    const prevMonth      = month === 1 ? 12 : month - 1;
    const prevYear       = month === 1 ? year - 1 : year;
    const prevPeriodStart = new Date(prevYear, prevMonth - 1, 1);
    const prevPeriodEnd   = new Date(prevYear, prevMonth, 1);

    // ── Fetch data in parallel ─────────────────────────────────────────
    const [
      currentOrders,
      previousOrders,
      monthlyRecord,
      prevMonthlyRecord,
      allMonthlyRecords,
    ] = await Promise.all([
      Order.find({ pharmacyId, createdAt: { $gte: periodStart, $lt: periodEnd } })
        .select("status totalPrice commissionAmount pharmacyEarning orderType paymentMethod items createdAt completedAt")
        .lean(),
      Order.find({ pharmacyId, createdAt: { $gte: prevPeriodStart, $lt: prevPeriodEnd } })
        .select("status totalPrice commissionAmount pharmacyEarning createdAt")
        .lean(),
      MonthlyPayment.findOne({ pharmacyId, year, month }).lean(),
      MonthlyPayment.findOne({ pharmacyId, year: prevYear, month: prevMonth }).lean(),
      MonthlyPayment.find({ pharmacyId }).sort({ year: -1, month: -1 }).limit(12).lean(),
    ]);

    // ── Current month aggregates ───────────────────────────────────────
    const completed  = currentOrders.filter(o => o.status === "Completed");
    const cancelled  = currentOrders.filter(o => o.status === "Cancelled");
    const pending    = currentOrders.filter(o => !["Completed", "Cancelled"].includes(o.status));

    const totalRevenue     = completed.reduce((s, o) => s + (o.totalPrice      || 0), 0);
    const totalCommission  = completed.reduce((s, o) => s + (o.commissionAmount || 0), 0);
    const totalNetEarnings = completed.reduce((s, o) => s + (o.pharmacyEarning  || 0), 0);
    const avgOrderValue    = completed.length ? totalRevenue / completed.length : 0;

    // ── Previous month aggregates ──────────────────────────────────────
    const prevCompleted      = previousOrders.filter(o => o.status === "Completed");
    const prevTotalRevenue   = prevCompleted.reduce((s, o) => s + (o.totalPrice || 0), 0);
    const prevTotalNet       = prevCompleted.reduce((s, o) => s + (o.pharmacyEarning || 0), 0);
    const prevCompletedCount = prevCompleted.length;

    const revenueChange  = prevTotalRevenue   ? ((totalRevenue     - prevTotalRevenue)   / prevTotalRevenue   * 100) : null;
    const netChange      = prevTotalNet       ? ((totalNetEarnings - prevTotalNet)       / prevTotalNet       * 100) : null;
    const ordersChange   = prevCompletedCount ? ((completed.length - prevCompletedCount) / prevCompletedCount * 100) : null;

    // ── Time series ────────────────────────────────────────────────────
    const dailyBreakdown  = groupByDay(currentOrders);
    const weeklyBreakdown = groupByWeek(currentOrders);

    // ── Breakdowns ─────────────────────────────────────────────────────
    const byPaymentMethod = paymentMethodBreakdown(currentOrders);
    const byOrderType     = orderTypeBreakdown(currentOrders);
    const topItems        = topSellingItems(currentOrders);

    // ── Historical monthly trend (last 12 months) ─────────────────────
    const monthlyTrend = allMonthlyRecords.map(r => ({
      year:             r.year,
      month:            r.month,
      totalRevenue:     r.totalRevenue,
      totalNetEarnings: r.totalNetEarnings,
      totalCommission:  r.totalCommission,
      totalOrders:      r.totalOrders,
      status:           r.status,
    })).reverse();

    // ── Payment status ─────────────────────────────────────────────────
    const billingStatus = {
      status:          monthlyRecord?.status          || "pending",
      totalCommission: monthlyRecord?.totalCommission || totalCommission,
      paidAt:          monthlyRecord?.paidAt          || null,
      paidAmount:      monthlyRecord?.paidAmount      || 0,
    };

    // ── Build context for AI ────────────────────────────────────────────
    const aiContext = {
      period:          { year, month },
      summary: {
        totalOrders:      currentOrders.length,
        completedOrders:  completed.length,
        cancelledOrders:  cancelled.length,
        pendingOrders:    pending.length,
        totalRevenue:     +totalRevenue.toFixed(2),
        totalCommission:  +totalCommission.toFixed(2),
        totalNetEarnings: +totalNetEarnings.toFixed(2),
        avgOrderValue:    +avgOrderValue.toFixed(2),
        cancellationRate: currentOrders.length
          ? +((cancelled.length / currentOrders.length) * 100).toFixed(1)
          : 0,
      },
      vsLastMonth: {
        revenueChange:  revenueChange  !== null ? +revenueChange.toFixed(1)  : null,
        netChange:      netChange      !== null ? +netChange.toFixed(1)      : null,
        ordersChange:   ordersChange   !== null ? +ordersChange.toFixed(1)   : null,
        prevRevenue:    +prevTotalRevenue.toFixed(2),
        prevNetEarnings:+prevTotalNet.toFixed(2),
        prevOrders:     prevCompletedCount,
      },
      topPaymentMethods: byPaymentMethod.slice(0, 3),
      topOrderTypes:     byOrderType,
      weeklyBreakdown:   weeklyBreakdown.map(w => ({
        weekStart:    w.weekStart,
        revenue:      +w.revenue.toFixed(2),
        netEarnings:  +w.netEarnings.toFixed(2),
        orders:       w.orders,
        cancelled:    w.cancelled,
      })),
      billingStatus,
      historicalTrend: monthlyTrend.slice(-6),
    };

    // ── AI Analysis ────────────────────────────────────────────────────
    let aiAnalysis = null;
    try {
      const result = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: `You are a financial analyst for "Shefaa Pharmacy" app.
Analyze the pharmacy's financial data for the given month and provide:
1. A brief executive summary (2-3 sentences)
2. Key strengths observed this month
3. Areas of concern or risk
4. 3 specific actionable recommendations to improve revenue or reduce costs
5. An overall financial health score out of 10 with justification

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "executiveSummary": "string",
  "strengths": ["string", "string"],
  "concerns": ["string", "string"],
  "recommendations": ["string", "string", "string"],
  "healthScore": number,
  "healthScoreJustification": "string"
}`,
          },
          {
            role: "user",
            content: `Analyze this pharmacy financial data:\n${JSON.stringify(aiContext, null, 2)}`,
          },
        ],
      });

      const raw  = result.choices[0]?.message?.content?.trim() || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      aiAnalysis  = JSON.parse(clean);
    } catch (aiErr) {
      console.warn("AI analysis failed:", aiErr.message);
      aiAnalysis = null;
    }

    // ── Final response ─────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        period:          { year, month },
        summary: {
          totalOrders:      currentOrders.length,
          completedOrders:  completed.length,
          cancelledOrders:  cancelled.length,
          pendingOrders:    pending.length,
          totalRevenue:     +totalRevenue.toFixed(2),
          totalCommission:  +totalCommission.toFixed(2),
          totalNetEarnings: +totalNetEarnings.toFixed(2),
          avgOrderValue:    +avgOrderValue.toFixed(2),
          cancellationRate: currentOrders.length
            ? +((cancelled.length / currentOrders.length) * 100).toFixed(1)
            : 0,
        },
        vsLastMonth: {
          revenueChange,
          netChange,
          ordersChange,
          prevRevenue:     +prevTotalRevenue.toFixed(2),
          prevNetEarnings: +prevTotalNet.toFixed(2),
          prevOrders:      prevCompletedCount,
        },
        charts: {
          daily:         dailyBreakdown,
          weekly:        weeklyBreakdown,
          byPaymentMethod,
          byOrderType,
          monthlyTrend,
        },
        topItems,
        billingStatus,
        aiAnalysis,
      },
    });
  } catch (err) {
    console.error("getFinanceReport error:", err);
    return res.status(500).json({ success: false, message: "Failed to generate finance report", error: err.message });
  }
};