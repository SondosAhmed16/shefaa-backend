// controllers/pharmacyBillingController.js

const Pharmacy = require("../Models/Pharmaces");
const Order = require("../Models/Order");
const BillingRecord = require("../Models/BillingRecord");

const PLATFORM_FEE_RATE = 0.01; // 5% للصيدليات — غيّريه على حسب المتفق عليه

// ─── Helpers ────────────────────────────────────────────────────────────────

const getMonthRangeUTC = (month, year) => {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { start, end };
};

/**
 * يحسب الـ revenue الحقيقي من جدول Orders (مش من الفرونت)
 * بيعتمد على orders الـ status بتاعها "Completed" في الشهر المطلوب
 */
async function computePharmacyRevenue(pharmacyId, month, year) {
    const { start, end } = getMonthRangeUTC(month, year);

    const completedOrders = await Order.find({
        pharmacyId,
        status: "Completed",
        createdAt: { $gte: start, $lt: end },
    }).lean();

    const totalRevenue = completedOrders.reduce(
        (sum, o) => sum + (o.totalPrice || 0),
        0
    );

    return {
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        activityCount: completedOrders.length,
    };
}

// ─── GET /api/pharmacy/billing/summary?month=&year= ─────────────────────────
// يرجع ملخص الفلوس المستحقة بدون ما يسجل أي شيء (read-only preview)
exports.getBillingSummary = async (req, res) => {
    try {
        const month = parseInt(req.query.month, 10);
        const year = parseInt(req.query.year, 10);

        if (!month || !year || month < 1 || month > 12) {
            return res.status(400).json({ message: "month و year مطلوبين وصحيحين." });
        }

        const pharmacy = await Pharmacy.findOne({ userId: req.user._id }).lean();
        if (!pharmacy) {
            return res.status(404).json({ message: "Pharmacy profile not found." });
        }

        const { totalRevenue, activityCount } = await computePharmacyRevenue(
            pharmacy._id,
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
        console.error("pharmacy getBillingSummary error:", err);
        return res.status(500).json({ message: "Internal server error." });
    }
};

// ─── POST /api/pharmacy/billing/pay ─────────────────────────────────────────
// Body: { month, year }
// بيسجل الدفع فعليًا في BillingRecord
exports.payPlatformFee = async (req, res) => {
    try {
        const { month, year } = req.body;
        const m = parseInt(month, 10);
        const y = parseInt(year, 10);

        if (!m || !y || m < 1 || m > 12) {
            return res.status(400).json({ message: "month و year مطلوبين وصحيحين." });
        }

        const pharmacy = await Pharmacy.findOne({ userId: req.user._id }).lean();
        if (!pharmacy) {
            return res.status(404).json({ message: "Pharmacy profile not found." });
        }

        // منع الدفع لشهر لسه مايجاش (مستقبلي بالكامل)
        const now = new Date();
        if (
            y > now.getFullYear() ||
            (y === now.getFullYear() && m > now.getMonth() + 1)
        ) {
            return res.status(400).json({ message: "لا يمكن دفع رسوم شهر لم يبدأ بعد." });
        }

        // هل مدفوع قبل كده؟
        const existing = await BillingRecord.findOne({
            entity: req.user._id,
            month: m,
            year: y,
        });

        if (existing?.paid) {
            return res.status(409).json({
                message: "رسوم هذا الشهر مدفوعة بالفعل.",
                record: existing,
            });
        }

        // الحساب الحقيقي من الداتابيز (مش من الفرونت)
        const { totalRevenue, activityCount } = await computePharmacyRevenue(
            pharmacy._id,
            m,
            y
        );

        if (totalRevenue <= 0) {
            return res.status(400).json({ message: "لا توجد إيرادات مكتملة لهذا الشهر." });
        }

        const dueAmount = parseFloat((totalRevenue * PLATFORM_FEE_RATE).toFixed(2));

        // ── هنا مكان دمج Payment Gateway حقيقي (Paymob/Stripe) لو حابة ──
        // مؤقتًا: نعتبر الدفع نجح فورًا (mock)

        const record = await BillingRecord.findOneAndUpdate(
            { entity: req.user._id, month: m, year: y },
            {
                $set: {
                    entity: req.user._id,
                    entityProfile: pharmacy._id,
                    entityProfileModel: "Pharmacy",
                    entityType: "pharmacy",
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

        // ── NEW: لو الصيدلية كانت متحجبة بسبب الفلوس، نرجعها visible ─────────────
        const pharmacyFull = await Pharmacy.findById(pharmacy._id).select("visibilityStatus hiddenReason");

        if (pharmacyFull?.visibilityStatus === "hidden" && pharmacyFull.hiddenReason === "unpaid_platform_fee") {
            const otherUnpaid = await BillingRecord.findOne({
                entity: req.user._id,
                paid: false,
                dueAmount: { $gt: 0 },
            });

            if (!otherUnpaid) {
                await Pharmacy.findByIdAndUpdate(pharmacy._id, {
                    $set: {
                        visibilityStatus: "active",
                        hiddenReason: null,
                        hiddenAt: null,
                    },
                });
            }
        }

        return res.status(200).json({
            message: "paid successfully",
            record,
        });
    } catch (err) {
        // race condition على الـ unique index
        if (err.code === 11000) {
            return res.status(409).json({ message: "The payment process for this month has been pre-paid." });
        }
        console.error("pharmacy payPlatformFee error:", err);
        return res.status(500).json({ message: "Internal server error." });
    }
};

// ─── GET /api/pharmacy/billing/history ──────────────────────────────────────
// يرجع كل سجلات الدفع السابقة للصيدلية
exports.getBillingHistory = async (req, res) => {
    try {
        const records = await BillingRecord.find({ entity: req.user._id })
            .sort({ year: -1, month: -1 })
            .lean();

        return res.status(200).json({ records });
    } catch (err) {
        console.error("pharmacy getBillingHistory error:", err);
        return res.status(500).json({ message: "Internal server error." });
    }
};

// ─── Auto-hide: تتنادى أول كل شهر، بتحجب أي صيدلية عندها fee الشهر اللي فات لسه متدفعتش ──
exports.autoSuspendUnpaidPharmacies = async function () {
    const now = new Date();

    // now.getMonth() مش بتحتاج -1 هنا، لأنها أصلاً 0-indexed
    // فلو دلوقتي يوليو (شهر 7 → getMonth()=6) فده بالظبط رقم يونيو (الشهر اللي فات) 1-indexed
    let prevMonth = now.getMonth();
    let prevYear = now.getFullYear();
    if (prevMonth === 0) {
        prevMonth = 12;
        prevYear -= 1;
    }

    const pharmacies = await Pharmacy.find({}).select("_id userId visibilityStatus hiddenReason");

    let hiddenCount = 0;

    for (const pharmacy of pharmacies) {
        try {
            // لو الصيدلية متوقفة من الإدمن يدويًا، منلمسهاش خالص
            if (pharmacy.visibilityStatus === "suspended") continue;

            const { totalRevenue, activityCount } = await computePharmacyRevenue(
                pharmacy._id,
                prevMonth,
                prevYear
            );

            const dueAmount = parseFloat((totalRevenue * PLATFORM_FEE_RATE).toFixed(2));

            if (dueAmount <= 0) continue; // مفيش إيراد الشهر اللي فات → مفيش fee → مفيش حجب

            const existingRecord = await BillingRecord.findOne({
                entity: pharmacy.userId,
                month: prevMonth,
                year: prevYear,
            });

            if (existingRecord?.paid) continue; // مدفوعة بالفعل، تمام

            // نسجل/نحدّث الفاتورة كـ "مستحقة" حتى لو معندهاش سجل من الأساس
            await BillingRecord.findOneAndUpdate(
                { entity: pharmacy.userId, month: prevMonth, year: prevYear },
                {
                    $setOnInsert: {
                        entity: pharmacy.userId,
                        entityProfile: pharmacy._id,
                        entityProfileModel: "Pharmacy",
                        entityType: "pharmacy",
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

            // نحجبها لو لسه مش متحجبة بسبب الفلوس بالظبط
            if (!(pharmacy.visibilityStatus === "hidden" && pharmacy.hiddenReason === "unpaid_platform_fee")) {
                await Pharmacy.findByIdAndUpdate(pharmacy._id, {
                    $set: {
                        visibilityStatus: "hidden",
                        hiddenReason: "unpaid_platform_fee",
                        hiddenAt: new Date(),
                    },
                });
                hiddenCount++;
            }
        } catch (err) {
            console.error(`autoSuspendUnpaidPharmacies error for pharmacy ${pharmacy._id}:`, err.message);
        }
    }

    console.log(`[Billing Cron] فحصنا ${pharmacies.length} صيدلية، اتحجب منهم ${hiddenCount} بسبب فلوس متأخرة.`);
};