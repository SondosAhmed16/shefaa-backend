/**
 * commissionService.js
 * All commission calculations happen here — never trusted from client input.
 */
const Order = require("../Models/Order");
const Pharmacy = require("../Models/Pharmaces");
const MonthlyPayment = require("../Models/MonthlyPayment");

const DEFAULT_COMMISSION_RATE = 1; // 1%

/**
 * Calculate commission figures for an order total.
 * @param {number} totalPrice
 * @param {number} rate - commission % (default 1)
 */
function calculateCommission(totalPrice, rate = DEFAULT_COMMISSION_RATE) {
  const commissionAmount = parseFloat(((totalPrice * rate) / 100).toFixed(2));
  const pharmacyEarning = parseFloat((totalPrice - commissionAmount).toFixed(2));
  return { commissionRate: rate, commissionAmount, pharmacyEarning };
}

/**
 * Called when an order is marked Completed.
 * Updates the order's financial fields and the pharmacy's running totals.
 * Also upserts the current month's MonthlyPayment record.
 */
async function applyCommissionOnCompletion(orderId, session = null) {
  const opts = session ? { session } : {};

  const order = await Order.findById(orderId).session(session || null);
  if (!order) throw new Error("Order not found");
  if (order.commissionAmount > 0) return; // already processed

  const pharmacy = await Pharmacy.findById(order.pharmacyId).session(session || null);
  if (!pharmacy) throw new Error("Pharmacy not found");

  const rate = pharmacy.commissionRate ?? DEFAULT_COMMISSION_RATE;
  const { commissionAmount, pharmacyEarning } = calculateCommission(order.totalPrice, rate);

  // 1. Update order
  order.commissionRate = rate;
  order.commissionAmount = commissionAmount;
  order.pharmacyEarning = pharmacyEarning;
  await order.save(opts);

  // 2. Update pharmacy running totals
  await Pharmacy.findByIdAndUpdate(
    pharmacy._id,
    {
      $inc: {
        "financials.totalRevenue": order.totalPrice,
        "financials.totalCommission": commissionAmount,
        "financials.totalNetEarnings": pharmacyEarning,
        "financials.currentDue": commissionAmount,
      },
      $set: { "financials.paymentStatus": "due" },
    },
    opts
  );

  // 3. Upsert monthly payment record
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  await MonthlyPayment.findOneAndUpdate(
    { pharmacyId: pharmacy._id, year, month },
    {
      $inc: {
        totalOrders: 1,
        totalRevenue: order.totalPrice,
        totalCommission: commissionAmount,
        totalNetEarnings: pharmacyEarning,
      },
      $push: { orderIds: order._id },
      $setOnInsert: { status: "pending" },
    },
    { upsert: true, new: true, ...opts }
  );

  return { commissionAmount, pharmacyEarning };
}

/**
 * Check if today falls within the 3-day payment window
 * (days 1, 2, 3 of the current month).
 */
function isWithinPaymentWindow() {
  const day = new Date().getDate();
  return day >= 1 && day <= 3;
}

/**
 * Run overdue check — called by a scheduled job (e.g. cron at day 4 00:00).
 * Marks all pending MonthlyPayment records as overdue and hides their pharmacies.
 */
async function runOverdueCheck() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // Only run after the 3-day window
  if (day <= 3) return { skipped: true, reason: "Still within payment window" };

  // Find all pending records for the current billing month
  const pendingRecords = await MonthlyPayment.find({
    year,
    month,
    status: "pending",
  });

  const overdueIds = pendingRecords.map((r) => r.pharmacyId);

  if (overdueIds.length === 0) return { overdueCount: 0 };

  // Mark records as overdue
  await MonthlyPayment.updateMany(
    { _id: { $in: pendingRecords.map((r) => r._id) } },
    { $set: { status: "overdue" } }
  );

  // Hide pharmacies with overdue payments
  await Pharmacy.updateMany(
    { _id: { $in: overdueIds } },
    {
      $set: {
        visibilityStatus: "hidden",
        hiddenAt: now,
        hiddenReason: `Overdue commission payment for ${year}-${String(month).padStart(2, "0")}`,
        "financials.paymentStatus": "overdue",
        "financials.overdueAt": now,
      },
    }
  );

  return { overdueCount: overdueIds.length, overduePharmacyIds: overdueIds };
}

module.exports = {
  calculateCommission,
  applyCommissionOnCompletion,
  isWithinPaymentWindow,
  runOverdueCheck,
  DEFAULT_COMMISSION_RATE,
};