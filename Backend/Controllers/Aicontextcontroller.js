// controllers/AiDoctorContextController.js
//
// Internal context builder for the AI doctor assistant.
// Called by AiDoctorController.js — NOT an Express route handler.
//
// Usage:
//   const { getAIChatContext } = require("./AiDoctorContextController");
//   const result = await getAIChatContext(req.user);  // pass user object directly
//   if (!result.success) { ... }
//   const ctx = result.data;

const Doctor = require("../Models/Doctors");
const Clinic = require("../Models/Clinic");
const Appointment = require("../Models/Appointment");
const Patient = require("../Models/Patients");
const Transaction = require("../Models/Transaction");
const User = require("../Models/Users");

/**
 * Builds a rich context snapshot for the AI assistant.
 *
 * @param {Object} userObj  - req.user (populated by auth middleware)
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
exports.getAIChatContext = async (userObj) => {
  try {
    // ── 0. Validate input ────────────────────────────────────────────────────
    if (!userObj) {
      return { success: false, error: "User object is missing." };
    }

    const userId = userObj._id || userObj.id;
    if (!userId) {
      return { success: false, error: "User ID not found in user object." };
    }

    // ── 1. Load doctor profile ───────────────────────────────────────────────
    const doctor = await Doctor.findOne({ userId })
      .populate("userId", "name email phone")
      .lean();

    if (!doctor) {
      return { success: false, error: "Doctor profile not found." };
    }

    const doctorId = doctor._id;

    // ── 2. Load clinics ──────────────────────────────────────────────────────
    const clinics = await Clinic.find({ doctorId }).lean();

    const clinicsSummary = clinics.map((c) => ({
      _id: c._id,
      name: c.name,
      city: c.city,
      address: c.address,
      price: c.price,
      status: c.status,
      workingDays: (c.defaultSchedule?.days || [])
        .filter((d) => d.isActive)
        .map((d) => ({
          day: d.day,
          open: d.open,
          close: d.close,
          slotDuration: d.slotDuration ?? c.defaultSchedule?.slotDuration,
          dailyCapacity: d.dailyCapacity ?? c.defaultSchedule?.dailyCapacity,
        })),
    }));

    const approvedClinics = clinics.filter((c) => c.status === "approved");
    const pendingClinics = clinics.filter((c) => c.status === "pending");

    // ── 3. Date windows ──────────────────────────────────────────────────────
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setUTCHours(23, 59, 59, 999);

    const weekStart = new Date(todayStart);
    weekStart.setUTCDate(todayStart.getUTCDate() - todayStart.getUTCDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    // ── 4. Load appointments ─────────────────────────────────────────────────
    const [
      todayAppointments,
      thisWeekAppointments,
      thisMonthAppointments,
      upcomingAppointments,
      allTimeCount,
    ] = await Promise.all([
      // Today
      Appointment.find({ doctor: doctorId, date: { $gte: todayStart, $lte: todayEnd } })
        .populate({ path: "patient", select: "userId age gender", populate: { path: "userId", select: "name phone" } })
        .populate("clinic", "name city price")
        .lean(),

      // This week
      Appointment.find({ doctor: doctorId, date: { $gte: weekStart, $lt: weekEnd } })
        .select("status date slotStart clinic")
        .lean(),

      // This month
      Appointment.find({ doctor: doctorId, date: { $gte: monthStart, $lt: monthEnd } })
        .select("status paymentStatus paymentOption date clinic patient")
        .lean(),

      // Upcoming (next 10)
      Appointment.find({ doctor: doctorId, status: "upcoming", date: { $gte: todayStart } })
        .sort({ date: 1, slotStart: 1 })
        .limit(10)
        .populate({ path: "patient", select: "userId", populate: { path: "userId", select: "name" } })
        .populate("clinic", "name city price")
        .lean(),

      // All-time count
      Appointment.countDocuments({ doctor: doctorId }),
    ]);

    // ── 5. Summarise appointments ────────────────────────────────────────────
    const countByStatus = (arr) =>
      arr.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {});

    const todayByStatus = countByStatus(todayAppointments);
    const weekByStatus = countByStatus(thisWeekAppointments);
    const monthByStatus = countByStatus(thisMonthAppointments);

    const todayList = todayAppointments.map((a) => ({
      _id: a._id,
      status: a.status,
      slotStart: a.slotStart,
      slotEnd: a.slotEnd,
      paymentStatus: a.paymentStatus,
      paymentOption: a.paymentOption,
      isFollowUp: a.isFollowUp,
      clinic: a.clinic?.name,
      patient: {
        name: a.patient?.userId?.name || "Unknown",
        phone: a.patient?.userId?.phone || null,
        age: a.patient?.age || null,
        gender: a.patient?.gender || null,
      },
    }));

    const upcomingList = upcomingAppointments.map((a) => ({
      _id: a._id,
      date: a.date,
      slotStart: a.slotStart,
      clinic: a.clinic?.name,
      clinicPrice: a.clinic?.price,
      patient: a.patient?.userId?.name || "Unknown",
    }));

    // ── 6. Patients summary ──────────────────────────────────────────────────
    // Unique patients from all-time appointments
    const allAppointmentPatientIds = await Appointment.distinct("patient", { doctor: doctorId });

    const noShowCount = await Appointment.countDocuments({
      doctor: doctorId,
      status: "no-show",
    });

    const followUpCount = await Appointment.countDocuments({
      doctor: doctorId,
      isFollowUp: true,
    });

    // ── 7. Financials ────────────────────────────────────────────────────────
    const PLATFORM_FEE_RATE = 0.015;

    // Revenue this month (from completed transactions)
    const monthlyTransactions = await Transaction.aggregate([
      {
        $match: {
          recipient: userId,
          status: "completed",
          type: "appointment_fee",
          createdAt: { $gte: monthStart, $lt: monthEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
          totalPlatformFee: { $sum: "$platformFeeAmount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const monthTx = monthlyTransactions[0] || { totalRevenue: 0, totalPlatformFee: 0, count: 0 };

    // Expected revenue from upcoming appointments this month
    const upcomingThisMonth = thisMonthAppointments.filter(
      (a) => a.status === "upcoming"
    );

    // Get clinic prices for expected revenue calculation
    const clinicPriceMap = clinics.reduce((acc, c) => {
      acc[c._id.toString()] = c.price || 0;
      return acc;
    }, {});

    const expectedFromUpcoming = upcomingThisMonth.reduce((sum, a) => {
      const price = clinicPriceMap[a.clinic?.toString()] || 0;
      return sum + price;
    }, 0);

    // Per-clinic revenue breakdown this month
    const perClinicRevenue = await Transaction.aggregate([
      {
        $match: {
          recipient: userId,
          status: "completed",
          type: "appointment_fee",
          createdAt: { $gte: monthStart, $lt: monthEnd },
        },
      },
      {
        $lookup: {
          from: "appointments",
          localField: "relatedId",
          foreignField: "_id",
          as: "appointment",
        },
      },
      { $unwind: { path: "$appointment", preserveNullAndEmpty: true } },
      {
        $group: {
          _id: "$appointment.clinic",
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const perClinicBreakdown = perClinicRevenue.map((entry) => {
      const clinic = clinics.find((c) => c._id.toString() === entry._id?.toString());
      return {
        clinicId: entry._id,
        clinicName: clinic?.name || "Unknown",
        completedSessions: entry.count,
        revenue: entry.revenue,
      };
    });

    // Cancellation / completion rates this month
    const monthTotal = thisMonthAppointments.length;
    const monthCompleted = monthByStatus["completed"] || 0;
    const monthCancelled = monthByStatus["cancelled"] || 0;
    const monthUpcoming = monthByStatus["upcoming"] || 0;

    const completionRate = monthTotal > 0 ? Math.round((monthCompleted / monthTotal) * 100) : 0;
    const cancellationRate = monthTotal > 0 ? Math.round((monthCancelled / monthTotal) * 100) : 0;

    const avgRevenuePerSession =
      monthCompleted > 0 ? Math.round(monthTx.totalRevenue / monthCompleted) : 0;

    // ── 8. Build briefing text ───────────────────────────────────────────────
    const briefing = `
Dr. ${doctor.userId?.name} — ${doctor.specialization} | Rating: ${doctor.rating}/5 | Experience: ${doctor.yearsOfExperience} yrs

TODAY (${todayStart.toISOString().slice(0, 10)}):
  Total appointments: ${todayAppointments.length}
  Completed: ${todayByStatus["completed"] || 0} | Upcoming: ${todayByStatus["upcoming"] || 0} | Cancelled: ${todayByStatus["cancelled"] || 0} | No-show: ${todayByStatus["no-show"] || 0}

THIS WEEK:
  Total appointments: ${thisWeekAppointments.length}
  Completed: ${weekByStatus["completed"] || 0} | Upcoming: ${weekByStatus["upcoming"] || 0} | Cancelled: ${weekByStatus["cancelled"] || 0}

THIS MONTH:
  Total: ${monthTotal} | Completed: ${monthCompleted} | Cancelled: ${monthCancelled} | Upcoming: ${monthUpcoming}
  Completion rate: ${completionRate}% | Cancellation rate: ${cancellationRate}%
  Confirmed revenue: ${monthTx.totalRevenue} EGP | Platform fee: ${monthTx.totalPlatformFee.toFixed(2)} EGP
  Net earnings: ${(monthTx.totalRevenue - monthTx.totalPlatformFee).toFixed(2)} EGP
  Expected from upcoming: ${expectedFromUpcoming} EGP

CLINICS:
  Total: ${clinics.length} (${approvedClinics.length} approved, ${pendingClinics.length} pending)

PATIENTS:
  Unique patients: ${allAppointmentPatientIds.length}
  No-shows all time: ${noShowCount}
  Follow-up appointments: ${followUpCount}
  All-time appointments: ${allTimeCount}
`.trim();

    // ── 9. Return structured context ─────────────────────────────────────────
    return {
      success: true,
      data: {
        doctor: {
          _id: doctor._id,
          name: doctor.userId?.name,
          email: doctor.userId?.email,
          phone: doctor.userId?.phone,
          specialization: doctor.specialization,
          yearsOfExperience: doctor.yearsOfExperience,
          rating: doctor.rating,
          gender: doctor.gender,
          about: doctor.about,
          paymentOption: doctor.paymentOption,
          clinicConsultationPrice: doctor.clinicConsultationPrice,
        },

        clinics: clinicsSummary,

        appointments: {
          today: {
            total: todayAppointments.length,
            byStatus: todayByStatus,
            list: todayList,
          },
          thisWeek: {
            total: thisWeekAppointments.length,
            byStatus: weekByStatus,
          },
          thisMonth: {
            total: monthTotal,
            byStatus: monthByStatus,
          },
          upcoming: upcomingList,
          totalAllTime: allTimeCount,
        },

        patients: {
          totalUnique: allAppointmentPatientIds.length,
          noShowCount,
          followUpCount,
        },

        financials: {
          confirmedRevenueThisMonth: monthTx.totalRevenue,
          platformFeeThisMonth: parseFloat(monthTx.totalPlatformFee.toFixed(2)),
          netRevenueThisMonth: parseFloat(
            (monthTx.totalRevenue - monthTx.totalPlatformFee).toFixed(2)
          ),
          expectedFromUpcoming,
          totalProjectedThisMonth: monthTx.totalRevenue + expectedFromUpcoming,
          completedTransactionsThisMonth: monthTx.count,
          avgRevenuePerSession,
          completionRate,
          cancellationRate,
          perClinic: perClinicBreakdown,
          feeRate: `${(PLATFORM_FEE_RATE * 100).toFixed(1)}%`,
        },

        briefing,
      },
    };
  } catch (err) {
    console.error("getAIChatContext error:", err);
    return { success: false, error: err.message };
  }
};