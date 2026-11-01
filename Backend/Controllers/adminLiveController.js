// controllers/adminLive.controller.js
// ───────────────────────────────────────────────────────────────────────────
// GET /api/admin/live-counts?ordersSince=<ISO date>
// Light endpoint polled by the dashboard every ~25s. Returns numbers only.
// ───────────────────────────────────────────────────────────────────────────
const Order = require("../Models/Order");
const User = require("../Models/Users");
const BillingRecord = require("../Models/BillingRecord");

exports.getLiveCounts = async (req, res) => {
  try {
    const parsed = req.query.ordersSince ? new Date(req.query.ordersSince) : new Date();
    const since = isNaN(parsed) ? new Date() : parsed;
 
    // "blocked" = unpaid billing records of PAST months (current month is not overdue yet)
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const pastMonthsFilter = {
      paid: false,
      $or: [{ year: { $lt: y } }, { year: y, month: { $lt: m } }],
    };
 
    const [
      newOrders,
      latestOrders,
      pendingDoctors,
      pendingPharmacies,
      pendingLabs,
      blocked,
    ] = await Promise.all([
      Order.countDocuments({ createdAt: { $gt: since } }),
 
      Order.find({ createdAt: { $gt: since } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("orderNumber createdAt userId deliveryAddress.fullName")
        .populate("userId", "name")
        .lean(),
 
      // pending = account not verified yet (same rule the dashboard uses)
      User.countDocuments({ role: "doctor",   isVerified: false }),
      User.countDocuments({ role: "pharmacy", isVerified: false }),
      User.countDocuments({ role: "lab",      isVerified: false }),
 
      BillingRecord.countDocuments(pastMonthsFilter),
    ]);
 
    res.set("Cache-Control", "no-store");
    res.json({
      serverTime: new Date().toISOString(),
      newOrders,
      latestOrders: latestOrders.map((o) => ({
        _id: o._id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        customerName: o.deliveryAddress?.fullName || o.userId?.name || "",
      })),
      pending: { doctors: pendingDoctors, pharmacies: pendingPharmacies, labs: pendingLabs },
      blocked,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
 
// ── indexes (add to the schemas, then redeploy) ────────────────────────────
// orderSchema.index({ createdAt: -1 });                 // Order model
// userSchema.index({ role: 1, isVerified: 1 });         // User model
// billingRecordSchema.index({ paid: 1, year: 1, month: 1 }); // BillingRecord model
 