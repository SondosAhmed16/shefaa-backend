/**
 * pharmacyController.js  — Full updated version
 * Includes: profile, orders, inventory, delivery men,
 *           financial P&L, commission, monthly payments,
 *           visibility control, city delivery pricing.
 *
 * CHANGES FROM PREVIOUS VERSION:
 *  1. updateProfile now accepts `deliveryPricing` and saves to cityDeliveryPrices
 *  2. Added POST /finance/pay alias route handler (confirmPaymentAlias)
 *     that accepts { method, amount } instead of { monthlyPaymentId }
 *  3. Added GET /financials/payment-history endpoint
 *  4. completeOrder already existed — routes file just needs the button wired up
 *  5. acceptOrder — added statusHistory guard (Array.isArray check before push)
 *  6. markOrderReady — added statusHistory guard (Array.isArray check before push)
 *  7. completeOrder — added statusHistory guard (Array.isArray check before push)
 */

const mongoose = require("mongoose");
const Pharmacy = require("../Models/Pharmaces");
const MedicineStock = require("../Models/MedicineStock");
const Order = require("../Models/Order");
const DeliveryMan = require("../Models/DeliveryMan");
const MonthlyPayment = require("../Models/MonthlyPayment");
const User = require("../Models/Users");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");
const {
  applyCommissionOnCompletion,
  calculateCommission,
  isWithinPaymentWindow,
} = require("../middleware/CommissionService");

// ─── Shared helper ────────────────────────────────────────────────────────
const getPharmacy = (userId) => Pharmacy.findOne({ userId });

// ─── Shared statusHistory push helper ────────────────────────────────────
const pushStatus = (order, status, note) => {
  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  order.statusHistory.push({ status, changedAt: new Date(), note });
};

// ════════════════════════════════════════════════════════════════════════════
// PROFILE
// ════════════════════════════════════════════════════════════════════════════

exports.getProfile = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const pharmacyId = pharmacy._id;
    const [totalMedicines, totalOrders] = await Promise.all([
      MedicineStock.countDocuments({ pharmacyId }),
      Order.countDocuments({ pharmacyId, status: "Completed" }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pharmacyName: req.user.name,
        commercialRegisterNumber: pharmacy.commercialRegisterNumber,
        licenseExpiry: pharmacy.licenseExpiry,
        rating: pharmacy.rating,
        about: pharmacy.about,
        openNow: pharmacy.openNow,
        deliveryAvailable: pharmacy.deliveryAvailable,
        visibilityStatus: pharmacy.visibilityStatus,
        stats: { rating: pharmacy.rating, totalMedicines, totalOrders },
        phone: pharmacy.phone,
        workingHours: pharmacy.workingHours,
        addresses: pharmacy.addresses,
        deliveryArea: pharmacy.deliveryArea,
        cityDeliveryPrices: pharmacy.cityDeliveryPrices,
        deliveryPricing: pharmacy.cityDeliveryPrices,
        paymentMethods: pharmacy.paymentMethods,
        deliveryTime: pharmacy.deliveryTime,
        settings: {
          deliveryAvailable: pharmacy.deliveryAvailable,
          openNow: pharmacy.openNow,
          prescriptionOnly: pharmacy.prescriptionOnly,
        },
      },
    });
  } catch (err) {
    console.error("getProfile error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const pharmacy = await getPharmacy(userId);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const allowedFields = [
      "phone", "about", "workingHours", "deliveryArea", "deliveryTime",
      "paymentMethods", "addresses", "licenseExpiry", "medicalLicencePdf",
      "deliveryFee", "minimumOrder",
    ];

    const pharmacyUpdates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) pharmacyUpdates[field] = req.body[field];
    });

    if (req.body.deliveryPricing !== undefined) {
      const pricing = req.body.deliveryPricing;
      if (!Array.isArray(pricing))
        return res.status(400).json({ success: false, message: "deliveryPricing must be an array" });

      for (const item of pricing) {
        if (!item.city || typeof item.city !== "string")
          return res.status(400).json({ success: false, message: "Each deliveryPricing item must have a city string" });
        if (item.price === undefined || Number(item.price) < 0)
          return res.status(400).json({ success: false, message: `Invalid price for city: ${item.city}` });
      }
      pharmacyUpdates.cityDeliveryPrices = pricing.map((item) => ({
        city: item.city.trim(),
        price: Number(item.price),
      }));
      pharmacyUpdates.deliveryArea = pharmacyUpdates.cityDeliveryPrices.map((c) => c.city);
    }

    if (req.body.name !== undefined)
      await User.findByIdAndUpdate(userId, { $set: { name: req.body.name.trim() } });

    // ── نظف الـ addresses الجاية من الـ request ────────────────────────────
    if (pharmacyUpdates.addresses) {
      pharmacyUpdates.addresses = pharmacyUpdates.addresses.map((addr) => {
        const coords = addr.location?.coordinates;
        const valid =
          Array.isArray(coords) &&
          coords.length === 2 &&
          coords.every((c) => typeof c === "number" && isFinite(c));
        if (valid) return addr;
        const { location, ...rest } = addr;
        return rest;
      });
    }

    if (Object.keys(pharmacyUpdates).length === 0 && req.body.name === undefined)
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    const primaryAddr = (pharmacyUpdates.addresses ?? []).find(addr => {
      const coords = addr.location?.coordinates;
      return Array.isArray(coords) && coords.length === 2 && coords.every(c => typeof c === "number" && isFinite(c));
    });

    if (primaryAddr) {
      pharmacyUpdates.location = {
        type: "Point",
        coordinates: primaryAddr.location.coordinates
      };
    }
    // ── Step 1: شيل أي location مكسورة من الـ DB أولاً ───────────────────
    await Pharmacy.updateOne(
      { userId, "addresses.location.coordinates": { $size: 0 } },
      { $unset: { "addresses.$[elem].location": "" } },
      { arrayFilters: [{ "elem.location.coordinates": { $size: 0 } }] }
    );

    // ── Step 2: طبق الـ update ────────────────────────────────────────────
    const updated = await Pharmacy.findOneAndUpdate(
      { userId },
      { $set: pharmacyUpdates },
      { new: true, runValidators: true }
    );

    const user = await User.findById(userId).select("name");

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        pharmacyName: user.name,
        ...updated.toObject(),
        deliveryPricing: updated.cityDeliveryPrices,
      },
    });
  } catch (err) {
    console.error("updateProfile error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


// ─── Toggle Open ────────────────────────────────────────────────────────────
exports.toggleOpenStatus = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { openNow } = req.body;
    if (typeof openNow !== "boolean")
      return res.status(400).json({ success: false, message: "openNow must be boolean" });

    const extra = !openNow && pharmacy.deliveryAvailable ? { deliveryAvailable: false } : {};
    const updated = await Pharmacy.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { openNow, ...extra } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: openNow ? "Pharmacy is now Open" : "Pharmacy is now Closed",
      data: { openNow: updated.openNow, deliveryAvailable: updated.deliveryAvailable },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ─── Toggle Delivery ────────────────────────────────────────────────────────
exports.toggleDeliveryService = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { deliveryAvailable } = req.body;
    if (typeof deliveryAvailable !== "boolean")
      return res.status(400).json({ success: false, message: "deliveryAvailable must be boolean" });

    if (deliveryAvailable && !pharmacy.openNow)
      return res.status(400).json({ success: false, message: "Cannot enable delivery while pharmacy is closed" });

    const updated = await Pharmacy.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { deliveryAvailable } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: deliveryAvailable ? "Delivery enabled" : "Delivery disabled",
      data: { openNow: updated.openNow, deliveryAvailable: updated.deliveryAvailable },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// CITY DELIVERY PRICING
// ════════════════════════════════════════════════════════════════════════════

exports.getCityDeliveryPrices = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    return res.status(200).json({ success: true, data: pharmacy.cityDeliveryPrices });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.upsertCityDeliveryPrice = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { city, price } = req.body;
    if (!city || price === undefined || Number(price) < 0)
      return res.status(400).json({ success: false, message: "city and a non-negative price are required" });

    const idx = pharmacy.cityDeliveryPrices.findIndex(
      (c) => c.city.toLowerCase() === city.toLowerCase()
    );

    if (idx >= 0) {
      pharmacy.cityDeliveryPrices[idx].price = Number(price);
    } else {
      pharmacy.cityDeliveryPrices.push({ city: city.trim(), price: Number(price) });
    }

    await pharmacy.save();

    return res.status(200).json({
      success: true,
      message: `Delivery price for ${city} saved`,
      data: pharmacy.cityDeliveryPrices,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.deleteCityDeliveryPrice = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const city = decodeURIComponent(req.params.city);
    const before = pharmacy.cityDeliveryPrices.length;
    pharmacy.cityDeliveryPrices = pharmacy.cityDeliveryPrices.filter(
      (c) => c.city.toLowerCase() !== city.toLowerCase()
    );

    if (pharmacy.cityDeliveryPrices.length === before)
      return res.status(404).json({ success: false, message: "City not found in pricing list" });

    await pharmacy.save();
    return res.status(200).json({
      success: true,
      message: `Delivery price for ${city} removed`,
      data: pharmacy.cityDeliveryPrices,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════════════════════════════════════════

exports.getOrders = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { status, page = 1, limit = 20 } = req.query;
    const filter = { pharmacyId: pharmacy._id };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total, statusCounts] = await Promise.all([
      Order.find(filter)
        .populate("userId", "name phone")
        .populate("items.medicineId", "medicineName")
        .populate("deliveryManId", "name phones vehicle")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Order.countDocuments(filter),
      Order.aggregate([
        { $match: { pharmacyId: pharmacy._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const counts = statusCounts.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      data: {
        orders,
        statusCounts: counts,
        pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
      },
    });
  } catch (err) {
    console.error("getOrders error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.acceptOrder = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const order = await Order.findOne({ _id: req.params.orderId, pharmacyId: pharmacy._id });
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });
    if (order.status !== "New")
      return res.status(400).json({ success: false, message: `Cannot accept order with status "${order.status}"` });

    order.status = "Preparing";
    pushStatus(order, "Preparing", "Accepted by pharmacy");
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Order accepted",
      data: { orderId: order._id, newStatus: order.status },
    });
  } catch (err) {
    console.error("acceptOrder error:", err.stack || err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};

exports.markOrderReady = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const order = await Order.findOne({ _id: req.params.orderId, pharmacyId: pharmacy._id });
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });
    if (order.status !== "Preparing")
      return res.status(400).json({ success: false, message: `Cannot mark ready — current status: "${order.status}"` });

    if (order.orderType === "Delivery") {
      const { deliveryManId } = req.body;
      if (!deliveryManId)
        return res.status(400).json({ success: false, message: "deliveryManId required for delivery orders" });

      const dm = await DeliveryMan.findOne({ _id: deliveryManId, pharmacyId: pharmacy._id, isActive: true });
      if (!dm)
        return res.status(404).json({ success: false, message: "Delivery man not found" });
      if (dm.status === "Offline")
        return res.status(400).json({ success: false, message: `${dm.name} is offline` });

      if (order.deliveryManId) {
        await DeliveryMan.findByIdAndUpdate(order.deliveryManId, {
          $pull: { assignedOrders: order._id },
          $set: { status: "Available" },
        });
      }
      dm.assignedOrders.push(order._id);
      dm.status = "Busy";
      await dm.save();
      order.deliveryManId = dm._id;
    }

    order.status = "Ready";
    pushStatus(order, "Ready", "Ready for pickup/delivery");
    await order.save();
    await order.populate("deliveryManId", "name phones vehicle status");

    return res.status(200).json({
      success: true,
      message: "Order marked ready",
      data: { orderId: order._id, newStatus: order.status, deliveryMan: order.deliveryManId ?? null },
    });
  } catch (err) {
    console.error("markOrderReady error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};

exports.completeOrder = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const order = await Order.findOne({ _id: req.params.orderId, pharmacyId: pharmacy._id });
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });
    if (!["Ready", "Preparing"].includes(order.status))
      return res.status(400).json({ success: false, message: `Cannot complete order with status "${order.status}"` });

    order.status = "Completed";
    pushStatus(order, "Completed", "Completed");

    // Online payments — commission already collected via payment gateway
    const CASH_METHODS = ["Cash"];
    const isPaidOnline = !CASH_METHODS.includes(order.paymentMethod);
    if (isPaidOnline) {
      order.paymentStatus = "Paid";
      order.commissionPaid = true;
      order.commissionPaidAt = new Date();
    }

    await order.save();

    // Free the delivery man when order completes
    if (order.deliveryManId) {
      await DeliveryMan.findByIdAndUpdate(order.deliveryManId, {
        $pull: { assignedOrders: order._id },
        $set: { status: "Available" },
      });
    }

    // Always apply commission to update pharmacy financials + monthly record
    const commission = await applyCommissionOnCompletion(order._id);

    // If paid online, immediately reduce currentDue since commission is settled
    if (isPaidOnline) {
      await Pharmacy.findByIdAndUpdate(pharmacy._id, {
        $inc: { "financials.currentDue": -commission.commissionAmount },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Order completed",
      data: {
        orderId: order._id,
        newStatus: order.status,
        commissionAmount: commission.commissionAmount,
        pharmacyEarning: commission.pharmacyEarning,
        commissionPaid: order.commissionPaid,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (err) {
    console.error("completeOrder error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════════════════════════════════════

exports.getInventory = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { filter = "all", page = 1, limit = 20 } = req.query;
    const baseFilter = { pharmacyId: pharmacy._id };
    if (filter === "instock") baseFilter.inStock = true;
    if (filter === "outofstock") baseFilter.inStock = false;

    const skip = (Number(page) - 1) * Number(limit);
    const [medicines, total, lowStockItems, outOfStockCount] = await Promise.all([
      MedicineStock.find(baseFilter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      MedicineStock.countDocuments(baseFilter),
      MedicineStock.find({ pharmacyId: pharmacy._id, inStock: true, $expr: { $lte: ["$quantity", "$minThreshold"] } })
        .select("medicineName category quantity minThreshold price inStock"),
      MedicineStock.countDocuments({ pharmacyId: pharmacy._id, inStock: false }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        medicines,
        lowStockItems,
        summary: { total, lowStockCount: lowStockItems.length, outOfStockCount },
        pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.searchMedicines = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { q, page = 1, limit = 20 } = req.query;
    if (!q || q.trim().length < 2)
      return res.status(400).json({ success: false, message: "Query must be at least 2 chars" });

    const regex = new RegExp(q.trim(), "i");
    const filter = { pharmacyId: pharmacy._id, $or: [{ medicineName: regex }, { genericName: regex }, { category: regex }] };
    const skip = (Number(page) - 1) * Number(limit);
    const [medicines, total] = await Promise.all([
      MedicineStock.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      MedicineStock.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: { medicines, query: q, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.addMedicine = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { medicineName, category, price } = req.body;
    if (!medicineName || !category || price === undefined)
      return res.status(400).json({ success: false, message: "medicineName, category, price required" });

    const existing = await MedicineStock.findOne({ pharmacyId: pharmacy._id, medicineName: medicineName.trim() });
    if (existing)
      return res.status(409).json({ success: false, message: `"${medicineName}" already exists. Use restock to add quantity.` });

    const medicine = await MedicineStock.create({
      pharmacyId: pharmacy._id,
      ...req.body,
      medicineName: medicineName.trim(),
      price: Number(price),
      quantity: Number(req.body.quantity) || 0,
      minThreshold: req.body.minThreshold !== undefined ? Number(req.body.minThreshold) : 5,
    });

    return res.status(201).json({ success: true, message: "Medicine added", data: medicine });
  } catch (err) {
    console.error("addition error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.updateMedicine = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const allowed = [
      "medicineName", "genericName", "category", "dosageForm", "manufacturer",
      "barcode", "price", "quantity", "minThreshold", "inStock", "requiresPrescription",
      "expiryDate", "indications", "sideEffects", "dosageInstructions", "notes", "image",
    ];
    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (updates.expiryDate === "" || updates.expiryDate === null) {
      delete updates.expiryDate;
    }

    if (updates.quantity !== undefined) {
      updates.quantity = Number(updates.quantity);
      if (updates.quantity <= 0 && updates.inStock === undefined) updates.inStock = false;
    }

    const medicine = await MedicineStock.findOneAndUpdate(
      { _id: req.params.id, pharmacyId: pharmacy._id },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!medicine)
      return res.status(404).json({ success: false, message: "Medicine not found" });

    return res.status(200).json({ success: true, message: "Medicine updated", data: medicine });
  } catch (err) {
    console.error("updateMedicine error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};

exports.restockMedicine = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { quantity } = req.body;
    if (!quantity || Number(quantity) <= 0)
      return res.status(400).json({ success: false, message: "Quantity must be positive" });

    const medicine = await MedicineStock.findOne({ _id: req.params.id, pharmacyId: pharmacy._id });
    if (!medicine)
      return res.status(404).json({ success: false, message: "Medicine not found" });

    const previous = medicine.quantity;
    medicine.quantity += Number(quantity);
    if (!medicine.inStock && medicine.quantity > 0) medicine.inStock = true;
    await medicine.save();

    return res.status(200).json({
      success: true,
      message: `${medicine.medicineName} restocked`,
      data: {
        medicineId: medicine._id,
        medicineName: medicine.medicineName,
        previousQuantity: previous,
        addedQuantity: Number(quantity),
        currentQuantity: medicine.quantity,
        inStock: medicine.inStock,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// DELIVERY MEN
// ════════════════════════════════════════════════════════════════════════════

exports.getDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [deliveryMen, total, statusCounts] = await Promise.all([
      DeliveryMan.find({ pharmacyId: pharmacy._id, isActive: true })
        .populate("assignedOrders", "orderNumber status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      DeliveryMan.countDocuments({ pharmacyId: pharmacy._id, isActive: true }),
      DeliveryMan.aggregate([
        { $match: { pharmacyId: pharmacy._id, isActive: true } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const counts = statusCounts.reduce(
      (a, c) => { a[c._id] = c.count; return a; },
      { Available: 0, Busy: 0, Offline: 0 }
    );

    return res.status(200).json({
      success: true,
      data: {
        deliveryMen,
        summary: { total, ...counts },
        pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.searchDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { q } = req.query;
    if (!q || q.trim().length < 2)
      return res.status(400).json({ success: false, message: "Query must be at least 2 chars" });

    const regex = new RegExp(q.trim(), "i");
    const deliveryMen = await DeliveryMan.find({
      pharmacyId: pharmacy._id,
      isActive: true,
      $or: [{ name: regex }, { phones: regex }, { vehicle: regex }],
    }).populate("assignedOrders", "orderNumber status");

    return res.status(200).json({ success: true, data: { deliveryMen } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.addDeliveryMan = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { name, phones, vehicle } = req.body;
    if (!name || !vehicle || !phones?.length)
      return res.status(400).json({ success: false, message: "name, vehicle, at least one phone required" });

    const dup = await DeliveryMan.findOne({ pharmacyId: pharmacy._id, isActive: true, phones: { $in: phones } });
    if (dup)
      return res.status(409).json({ success: false, message: "Phone number already exists" });

    const dm = await DeliveryMan.create({ pharmacyId: pharmacy._id, ...req.body, name: name.trim() });
    return res.status(201).json({ success: true, message: "Delivery man added", data: dm });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.updateDeliveryMan = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const allowed = ["name", "email", "phones", "vehicle", "status", "address", "notes"];
    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (updates.status === "Available") updates.assignedOrders = [];

    const dm = await DeliveryMan.findOneAndUpdate(
      { _id: req.params.id, pharmacyId: pharmacy._id, isActive: true },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!dm)
      return res.status(404).json({ success: false, message: "Delivery man not found" });

    return res.status(200).json({ success: true, message: "Updated", data: dm });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.deleteDeliveryMan = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const dm = await DeliveryMan.findOne({ _id: req.params.id, pharmacyId: pharmacy._id, isActive: true });
    if (!dm)
      return res.status(404).json({ success: false, message: "Delivery man not found" });

    if (dm.status === "Busy" && dm.assignedOrders.length > 0)
      return res.status(400).json({ success: false, message: `${dm.name} has active orders. Change status first.` });

    dm.isActive = false;
    dm.status = "Offline";
    await dm.save();

    return res.status(200).json({ success: true, message: `${dm.name} removed` });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// FINANCIAL P&L
// ════════════════════════════════════════════════════════════════════════════

exports.getFinancials = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const year = Number(req.query.year) || new Date().getFullYear();

    const monthlyRecords = await MonthlyPayment.find({ pharmacyId: pharmacy._id, year }).sort({ month: 1 });

    const f = pharmacy.financials;

    const pendingRecords = await MonthlyPayment.find({
      pharmacyId: pharmacy._id,
      status: { $in: ["pending", "overdue"] },
    });

    const totalPending = pendingRecords.reduce((sum, r) => sum + r.totalCommission, 0);
    const withinWindow = isWithinPaymentWindow();

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRevenue: f.totalRevenue,
          totalCommission: f.totalCommission,
          totalNetEarnings: f.totalNetEarnings,
          currentDue: f.currentDue,
          paymentStatus: f.paymentStatus,
          lastPaidAmount: f.lastPaidAmount,
          lastPaidAt: f.lastPaidAt,
          commissionRate: pharmacy.commissionRate,
        },
        monthlyBreakdown: monthlyRecords.map((r) => ({
          _id: r._id,
          year: r.year,
          month: r.month,
          monthLabel: MONTHS[r.month - 1] || String(r.month),
          totalOrders: r.totalOrders,
          grossSales: r.totalRevenue,
          commission: r.totalCommission,
          netEarnings: r.totalNetEarnings,
          status: r.status === "paid" ? "Paid" : r.status === "overdue" ? "Overdue" : "Pending",
          paidAt: r.paidAt,
          paidAmount: r.paidAmount,
        })),
        payment: {
          withinWindow,
          windowDays: "1–3 of each month",
          pendingPayments: pendingRecords.map((r) => ({
            id: r._id,
            year: r.year,
            month: r.month,
            monthLabel: MONTHS[r.month - 1] || String(r.month),
            totalCommission: r.totalCommission,
            status: r.status === "overdue" ? "Overdue" : "Pending",
          })),
          totalPending,
        },
      },
    });
  } catch (err) {
    console.error("getFinancials error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getPaymentHistory = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { limit = 20, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const [records, total] = await Promise.all([
      MonthlyPayment.find({ pharmacyId: pharmacy._id, status: "paid" })
        .sort({ paidAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      MonthlyPayment.countDocuments({ pharmacyId: pharmacy._id, status: "paid" }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        history: records.map((r) => ({
          id: r._id,
          date: r.paidAt,
          amount: r.paidAmount ?? r.totalCommission,
          period: `${MONTHS[r.month - 1]} ${r.year}`,
          ref: `PAY-${String(r.year).slice(-2)}${String(r.month).padStart(2, "0")}-${String(r._id).slice(-3).toUpperCase()}`,
          year: r.year,
          month: r.month,
        })),
        pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
      },
    });
  } catch (err) {
    console.error("getPaymentHistory error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.confirmPaymentAlias = async (req, res) => {
  try {
    if (!isWithinPaymentWindow()) {
      return res.status(403).json({
        success: false,
        message: "Payment can only be submitted during the first 3 days of the month.",
      });
    }

    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { method, amount } = req.body;
    const ALLOWED_METHODS = ["Cash", "Visa", "Mastercard", "Instapay", "Meeza", "Vodafone Cash", "Etisalat Cash", "Orange Cash"];

    if (!method || !ALLOWED_METHODS.includes(method))
      return res.status(400).json({ success: false, message: `Invalid payment method. Allowed: ${ALLOWED_METHODS.join(", ")}` });

    const pendingRecords = await MonthlyPayment.find({
      pharmacyId: pharmacy._id,
      status: { $in: ["pending", "overdue"] },
    });

    if (pendingRecords.length === 0)
      return res.status(400).json({ success: false, message: "No pending payments found" });

    const totalDue = pendingRecords.reduce((sum, r) => sum + r.totalCommission, 0);
    const now = new Date();

    await Promise.all(
      pendingRecords.map((record) => {
        record.status = "paid";
        record.paidAt = now;
        record.paidAmount = record.totalCommission;
        if (method) record.paymentMethod = method;
        return record.save();
      })
    );

    const allOrderIds = pendingRecords.flatMap((r) => r.orderIds || []);
    if (allOrderIds.length > 0) {
      await Order.updateMany(
        { _id: { $in: allOrderIds } },
        { $set: { commissionPaid: true, commissionPaidAt: now } }
      );
    }

    await Pharmacy.findByIdAndUpdate(pharmacy._id, {
      $inc: { "financials.currentDue": -totalDue },
      $set: {
        "financials.lastPaidAmount": totalDue,
        "financials.lastPaidAt": now,
        "financials.paymentStatus": "up_to_date",
        visibilityStatus: "active",
        hiddenAt: null,
        hiddenReason: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Payment confirmed. Your pharmacy is now visible to patients.",
      data: { paidRecords: pendingRecords.length, totalPaid: totalDue, paidAt: now, method },
    });
  } catch (err) {
    console.error("confirmPaymentAlias error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.confirmPayment = async (req, res) => {
  try {
    if (!isWithinPaymentWindow()) {
      return res.status(403).json({
        success: false,
        message: "Payment can only be submitted during the first 3 days of the month.",
      });
    }

    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { monthlyPaymentId } = req.body;
    if (!monthlyPaymentId)
      return res.status(400).json({ success: false, message: "monthlyPaymentId required" });

    const record = await MonthlyPayment.findOne({ _id: monthlyPaymentId, pharmacyId: pharmacy._id });
    if (!record)
      return res.status(404).json({ success: false, message: "Payment record not found" });
    if (record.status === "paid")
      return res.status(400).json({ success: false, message: "Already paid" });

    const amount = record.totalCommission;
    record.status = "paid";
    record.paidAt = new Date();
    record.paidAmount = amount;
    await record.save();

    await Order.updateMany(
      { _id: { $in: record.orderIds } },
      { $set: { commissionPaid: true, commissionPaidAt: new Date(), commissionPaidInCycleId: record._id } }
    );

    await Pharmacy.findByIdAndUpdate(pharmacy._id, {
      $inc: { "financials.currentDue": -amount },
      $set: {
        "financials.lastPaidAmount": amount,
        "financials.lastPaidAt": new Date(),
        "financials.paymentStatus": "up_to_date",
        visibilityStatus: "active",
        hiddenAt: null,
        hiddenReason: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Payment confirmed. Your pharmacy is visible to patients.",
      data: { paidAmount: amount, paidAt: record.paidAt },
    });
  } catch (err) {
    console.error("confirmPayment error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getMonthlyDetail = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const { year, month } = req.params;
    const record = await MonthlyPayment.findOne({
      pharmacyId: pharmacy._id,
      year: Number(year),
      month: Number(month),
    });

    if (!record)
      return res.status(404).json({ success: false, message: "No data for this period" });

    const orders = await Order.find({ _id: { $in: record.orderIds } })
      .populate("userId", "name phone")
      .select("orderNumber totalPrice commissionAmount pharmacyEarning status createdAt");

    return res.status(200).json({
      success: true,
      data: {
        period: { year: record.year, month: record.month },
        summary: {
          totalOrders: record.totalOrders,
          totalRevenue: record.totalRevenue,
          totalCommission: record.totalCommission,
          totalNetEarnings: record.totalNetEarnings,
          status: record.status,
          paidAt: record.paidAt,
          paidAmount: record.paidAmount,
        },
        orders,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// STUBS
// ════════════════════════════════════════════════════════════════════════════

exports.getDashboardStats = async (req, res) => {
  res.status(501).json({ success: false, message: "Not implemented yet" });
};

exports.patientSearch = async (req, res) => {
  res.status(501).json({ success: false, message: "Not implemented yet" });
};

exports.getOrderTracking = async (req, res) => {
  res.status(501).json({ success: false, message: "Not implemented yet" });
};

exports.getLowStockAlerts = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const lowStockItems = await MedicineStock.find({
      pharmacyId: pharmacy._id,
      inStock: true,
      $expr: { $lte: ["$quantity", "$minThreshold"] },
    }).select("medicineName category quantity minThreshold price inStock");

    return res.status(200).json({
      success: true,
      data: { lowStockItems, count: lowStockItems.length },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getAvailableDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const deliveryMen = await DeliveryMan.find({
      pharmacyId: pharmacy._id,
      isActive: true,
      status: "Available",
    }).populate("assignedOrders", "orderNumber status");

    return res.status(200).json({
      success: true,
      data: { deliveryMen, count: deliveryMen.length },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getBusyDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy)
      return res.status(404).json({ success: false, message: "Pharmacy not found" });

    const deliveryMen = await DeliveryMan.find({
      pharmacyId: pharmacy._id,
      isActive: true,
      status: "Busy",
    }).populate("assignedOrders", "orderNumber status");

    return res.status(200).json({
      success: true,
      data: { deliveryMen, count: deliveryMen.length },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

