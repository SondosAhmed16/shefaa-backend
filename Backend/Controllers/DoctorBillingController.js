// controllers/billingController.js

const Doctor = require("../Models/Doctors");
const Appointment = require("../Models/Appointment");
const BillingRecord = require("../Models/BillingRecord");

const PLATFORM_FEE_RATE = 0.015; // 1.5% للدكاترة

// ─── Helpers ────────────────────────────────────────────────────────────────

const getMonthRangeUTC = (month, year) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
};

/**
 * يحسب الـ revenue الحقيقي من جدول Appointments (مش من الفرونت)
 * بيعتمد على appointments الـ status بتاعها "completed" في الشهر المطلوب
 */
async function computeDoctorRevenue(doctorId, month, year) {
  const { start, end } = getMonthRangeUTC(month, year);

  const completedAppointments = await Appointment.find({
    doctor: doctorId,
    status: "completed",
    date: { $gte: start, $lt: end },
  })
    .populate("clinic", "price")
    .lean();

  const totalRevenue = completedAppointments.reduce(
    (sum, a) => sum + (a.clinic?.price || 0),
    0
  );

  return {
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    activityCount: completedAppointments.length,
  };
}

// ─── GET /api/billing/summary?month=&year= ──────────────────────────────────
// يرجع ملخص الفلوس المستحقة بدون ما يسجل أي شيء (read-only preview)
exports.getBillingSummary = async (req, res) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);

    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ message: "month و year مطلوبين وصحيحين." });
    }

    const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
    if (!doctor) {
      return res.status(404).json({ message: "Doctor profile not found." });
    }

    const { totalRevenue, activityCount } = await computeDoctorRevenue(
      doctor._id,
      month,
      year
    );

    const dueAmount = parseFloat((totalRevenue * PLATFORM_FEE_RATE).toFixed(2));

    // هل موجود سجل دفع سابق لنفس الشهر؟
    const existingRecord = await BillingRecord.findOne({
      entity: req.user._id,
      month,
      year,
    }).lean();

    return res.status(200).json({
      month,
      year,
      totalRevenue,
      activityCount,
      rate: PLATFORM_FEE_RATE,
      dueAmount,
      paid: existingRecord?.paid || false,
      paidAt: existingRecord?.paidAt || null,
      netProfit: parseFloat((totalRevenue - dueAmount).toFixed(2)),
    });
  } catch (err) {
    console.error("getBillingSummary error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── POST /api/billing/pay ───────────────────────────────────────────────────
// Body: { month, year }
// بيسجل الدفع فعليًا في BillingRecord
exports.payPlatformFee = async (req, res) => {
  try {
    const { month, year } = req.body;
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);

    if (!m || !y || m < 1 || m > 12) {
      return res.status(400).json({ message: "month and year are required and must be valid." });
    }

    const doctor = await Doctor.findOne({ userId: req.user._id }).lean();
    if (!doctor) {
      return res.status(404).json({ message: "Doctor profile not found." });
    }

    const now = new Date();
    const currentMonthInt = now.getMonth() + 1;
    const currentYearInt = now.getFullYear();

    const isCurrentOrFuture =
      y > currentYearInt ||
      (y === currentYearInt && m >= currentMonthInt);

    if (isCurrentOrFuture) {
      const isCurrent = y === currentYearInt && m === currentMonthInt;
      return res.status(400).json({
        message: isCurrent
          ? "Cannot pay fees for the current month until it ends. You can pay once the month is fully completed."
          : "Cannot pay fees for a month that has not started yet.",
        code: isCurrent ? "MONTH_NOT_ENDED" : "FUTURE_MONTH",
      });
    }

    // ── Recompute from DB (never trust frontend amounts) ─────────────────
    const { totalRevenue, activityCount } = await computeDoctorRevenue(
      doctor._id, m, y
    );

    if (totalRevenue <= 0) {
      return res.status(400).json({
        message: "No completed appointments found for this month.",
        code: "NO_REVENUE",
      });
    }

    const dueAmount = parseFloat((totalRevenue * PLATFORM_FEE_RATE).toFixed(2));

    // ── Check existing record ─────────────────────────────────────────────
    const existing = await BillingRecord.findOne({
      entity: req.user._id, month: m, year: y,
    });

    // ── Option B: handle stale paid record (paid mid-month, revenue grew) ─
    if (existing?.paid) {
      const delta = parseFloat((dueAmount - existing.dueAmount).toFixed(2));

      // No meaningful delta → genuinely already paid in full
      if (delta <= 0) {
        return res.status(409).json({
          message: "This month's fees have already been paid.",
          record: existing,
        });
      }

      // Delta exists → correct the record and collect the difference
      // TODO: charge `delta` via payment gateway before updating
      const corrected = await BillingRecord.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            totalRevenue,
            activityCount,
            dueAmount,
            paid: true,
            paidAt: new Date(),
            suspended: false,
            correctionNote: `Corrected on ${new Date().toISOString()}. Original due: ${existing.dueAmount} EGP. Delta charged: ${delta} EGP.`,
            correctionDelta: delta,
          },
        },
        { new: true }
      );

      return res.status(200).json({
        message: "Payment corrected and delta collected successfully.",
        delta,
        record: corrected,
      });
    }

    // ── Fresh payment ─────────────────────────────────────────────────────
    // TODO: integrate real payment gateway here (Paymob / Stripe)

    const record = await BillingRecord.findOneAndUpdate(
      { entity: req.user._id, month: m, year: y },
      {
        $set: {
          entity: req.user._id,
          entityProfile: doctor._id,
          entityProfileModel: "Doctor",
          entityType: "doctor",
          month: m,
          year: y,
          totalRevenue,
          activityCount,
          rate: PLATFORM_FEE_RATE,
          dueAmount,
          paid: true,
          paidAt: new Date(),
          suspended: false,
        },
      },
      { upsert: true, new: true }
    );

    // ── Restore visibility if hidden for unpaid fees ──────────────────────
    const doctorFull = await Doctor.findById(doctor._id)
      .select("visibilityStatus hiddenReason");

    if (
      doctorFull?.visibilityStatus === "hidden" &&
      doctorFull.hiddenReason === "unpaid_platform_fee"
    ) {
      const otherUnpaid = await BillingRecord.findOne({
        entity: req.user._id,
        paid: false,
        dueAmount: { $gt: 0 },
      });

      if (!otherUnpaid) {
        await Doctor.findByIdAndUpdate(doctor._id, {
          $set: {
            visibilityStatus: "active",
            hiddenReason: null,
            hiddenAt: null,
          },
        });
      }
    }

    return res.status(200).json({ message: "Paid successfully.", record });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "This month's payment has already been processed.",
      });
    }
    console.error("payPlatformFee error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── GET /api/billing/history ────────────────────────────────────────────────
// يرجع كل سجلات الدفع السابقة للدكتور
exports.getBillingHistory = async (req, res) => {
  try {
    const records = await BillingRecord.find({ entity: req.user._id })
      .sort({ year: -1, month: -1 })
      .lean();

    return res.status(200).json({ records });
  } catch (err) {
    console.error("getBillingHistory error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ─── Auto-hide: تتنادى أول كل شهر، بتحجب أي دكتور عنده fee الشهر اللي فات لسه متدفعتش ──
exports.autoSuspendUnpaidDoctors = async function () {
  const now = new Date();

  // now.getMonth() مش بتحتاج -1 هنا، لأنها أصلاً 0-indexed
  // فلو دلوقتي يوليو (شهر 7 → getMonth()=6) فده بالظبط رقم يونيو (الشهر اللي فات) 1-indexed
  let prevMonth = now.getMonth();
  let prevYear = now.getFullYear();
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }

  const doctors = await Doctor.find({}).select("_id userId visibilityStatus hiddenReason");

  let hiddenCount = 0;

  for (const doctor of doctors) {
    try {
      // لو الدكتور متوقف من الإدمن يدويًا، منلمسهوش خالص
      if (doctor.visibilityStatus === "suspended") continue;

      const { totalRevenue, activityCount } = await computeDoctorRevenue(
        doctor._id,
        prevMonth,
        prevYear
      );

      const dueAmount = parseFloat((totalRevenue * PLATFORM_FEE_RATE).toFixed(2));

      if (dueAmount <= 0) continue; // مفيش إيراد الشهر اللي فات → مفيش fee → مفيش حجب

      const existingRecord = await BillingRecord.findOne({
        entity: doctor.userId,
        month: prevMonth,
        year: prevYear,
      });

      if (existingRecord?.paid) continue; // مدفوعة بالفعل، تمام

      // نسجل/نحدّث الفاتورة كـ "مستحقة" حتى لو معندهوش سجل من الأساس
      await BillingRecord.findOneAndUpdate(
        { entity: doctor.userId, month: prevMonth, year: prevYear },
        {
          $setOnInsert: {
            entity: doctor.userId,
            entityProfile: doctor._id,
            entityProfileModel: "Doctor",
            entityType: "doctor",
            month: prevMonth,
            year: prevYear,
            totalRevenue,
            activityCount,
            rate: PLATFORM_FEE_RATE,
            dueAmount,
            paid: false,
          },
        },
        { upsert: true, new: true }
      );

      // نحجبه لو لسه مش متحجب بسبب الفلوس بالظبط
      if (!(doctor.visibilityStatus === "hidden" && doctor.hiddenReason === "unpaid_platform_fee")) {
        await Doctor.findByIdAndUpdate(doctor._id, {
          $set: {
            visibilityStatus: "hidden",
            hiddenReason: "unpaid_platform_fee",
            hiddenAt: new Date(),
          },
        });
        hiddenCount++;
      }
    } catch (err) {
      console.error(`autoSuspendUnpaidDoctors error for doctor ${doctor._id}:`, err.message);
    }
  }

  console.log(`[Billing Cron] فحصنا ${doctors.length} دكتور، اتحجب منهم ${hiddenCount} بسبب فلوس متأخرة.`);
};