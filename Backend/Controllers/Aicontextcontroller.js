const Pharmacy = require("../Models/Pharmaces");
const MedicineStock = require("../Models/MedicineStock");
const Order = require("../Models/Order");
const DeliveryMan = require("../Models/DeliveryMan");
const MonthlyPayment = require("../Models/MonthlyPayment");
const User = require("../Models/Users");

const getPharmacy = (userId) => Pharmacy.findOne({ userId });

// ════════════════════════════════════════════════════════════════════════════
// AI CHAT CONTEXT
// Builds a compact JSON snapshot of everything the chatbot may be asked about:
// profile/settings, inventory (stock levels, low stock, expiring soon),
// orders (status counts, recent), delivery men, and financials.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL helper — called by other controllers (no req/res)
// ════════════════════════════════════════════════════════════════════════════
exports.getAIChatContext = async (userObj) => {
  try {
    // ✅ بيقبل user object مباشرة (مش req)
    const userId = userObj._id || userObj.id;
    if (!userId) {
      return { success: false, error: "User ID not found" };
    }

    const pharmacy = await getPharmacy(userId);
    if (!pharmacy) {
      return { success: false, error: "Pharmacy not found" };
    }

    const pharmacyId = pharmacy._id;
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      user,
      medicines,
      orderStatusCounts,
      recentOrders,
      deliveryMen,
      monthlyRecords,
    ] = await Promise.all([
      User.findById(userId).select("name"),
      MedicineStock.find({ pharmacyId }).lean(),
      Order.aggregate([
        { $match: { pharmacyId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Order.find({ pharmacyId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("orderNumber status totalPrice paymentMethod paymentStatus orderType createdAt")
        .lean(),
      DeliveryMan.find({ pharmacyId, isActive: true })
        .select("name status vehicle")
        .lean(),
      MonthlyPayment.find({ pharmacyId, status: { $in: ["pending", "overdue"] } }).lean(),
    ]);

    // ── Inventory summary ────────────────────────────────────────────────
    let totalStockValue = 0;
    const lowStockItems = [];
    const outOfStockItems = [];
    const expiringSoon = [];
    const categoriesBreakdown = {};

    const medicinesSummary = medicines.map((m) => {
      const stockValue = (m.price || 0) * (m.quantity || 0);
      totalStockValue += stockValue;

      if (m.quantity === 0 || m.inStock === false) {
        outOfStockItems.push({ name: m.medicineName, category: m.category });
      } else if (m.quantity <= (m.minThreshold ?? 5)) {
        lowStockItems.push({
          name: m.medicineName,
          quantity: m.quantity,
          minThreshold: m.minThreshold ?? 5,
          category: m.category,
        });
      }

      if (m.expiryDate && new Date(m.expiryDate) <= thirtyDaysFromNow) {
        expiringSoon.push({
          name: m.medicineName,
          expiryDate: m.expiryDate,
          quantity: m.quantity,
        });
      }

      const cat = m.category || "other";
      if (!categoriesBreakdown[cat]) {
        categoriesBreakdown[cat] = { count: 0, totalQuantity: 0 };
      }
      categoriesBreakdown[cat].count += 1;
      categoriesBreakdown[cat].totalQuantity += m.quantity || 0;

      return {
        name: m.medicineName,
        genericName: m.genericName,
        category: m.category,
        dosageForm: m.dosageForm,
        price: m.price,
        quantity: m.quantity,
        minThreshold: m.minThreshold,
        inStock: m.inStock,
        requiresPrescription: m.requiresPrescription,
        expiryDate: m.expiryDate,
      };
    });

    // ── Orders summary ────────────────────────────────────────────────────
    const orderCounts = orderStatusCounts.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});

    const recentOrdersSummary = recentOrders.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      totalPrice: o.totalPrice,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      orderType: o.orderType,
      createdAt: o.createdAt,
    }));

    // ── Delivery men summary ──────────────────────────────────────────────
    const deliveryMenSummary = deliveryMen.map((d) => ({
      name: d.name,
      status: d.status,
      vehicle: d.vehicle,
    }));
    const deliveryCounts = deliveryMen.reduce(
      (acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      },
      { Available: 0, Busy: 0, Offline: 0 }
    );

    // ── Financials summary ────────────────────────────────────────────────
    const f = pharmacy.financials || {};
    const pendingPayments = monthlyRecords.map((r) => ({
      year: r.year,
      month: r.month,
      totalCommission: r.totalCommission,
      status: r.status,
    }));
    const totalPending = monthlyRecords.reduce((sum, r) => sum + (r.totalCommission || 0), 0);

    // ✅ بترجع data مباشرة بدل ما تعمل res.json()
    return {
      success: true,
      data: {
        profile: {
          pharmacyName: user?.name,
          openNow: pharmacy.openNow,
          deliveryAvailable: pharmacy.deliveryAvailable,
          visibilityStatus: pharmacy.visibilityStatus,
          rating: pharmacy.rating,
          workingHours: pharmacy.workingHours,
          deliveryArea: pharmacy.deliveryArea,
          cityDeliveryPrices: pharmacy.cityDeliveryPrices,
          paymentMethods: pharmacy.paymentMethods,
          deliveryTime: pharmacy.deliveryTime,
          commissionRate: pharmacy.commissionRate,
        },
        inventory: {
          totalItems: medicines.length,
          totalStockValue,
          lowStockItems,
          outOfStockItems,
          expiringSoon,
          categoriesBreakdown,
          medicines: medicinesSummary,
        },
        orders: {
          statusCounts: orderCounts,
          recentOrders: recentOrdersSummary,
        },
        deliveryMen: {
          summary: deliveryCounts,
          list: deliveryMenSummary,
        },
        financials: {
          totalRevenue: f.totalRevenue,
          totalCommission: f.totalCommission,
          totalNetEarnings: f.totalNetEarnings,
          currentDue: f.currentDue,
          paymentStatus: f.paymentStatus,
          lastPaidAmount: f.lastPaidAmount,
          lastPaidAt: f.lastPaidAt,
          pendingPayments,
          totalPending,
        },
      },
    };
  } catch (err) {
    console.error("getAIChatContext error:", err);
    return { success: false, error: err.message };
  }
};

// ════════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE HANDLER — للـ API endpoint العادي (لو محتاجه)
// ════════════════════════════════════════════════════════════════════════════
exports.getAIChatContextRoute = async (req, res) => {
  // ✅ بيبعت req.user للـ internal function
  const result = await exports.getAIChatContext(req.user);
  if (!result.success) {
    return res.status(result.error === "Pharmacy not found" ? 404 : 500).json({
      success: false,
      message: result.error,
    });
  }
  return res.status(200).json(result);
};