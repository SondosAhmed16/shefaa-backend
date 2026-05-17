const Pharmacy = require('../Models/Pharmaces');
const MedicineStock = require('../Models/MedicineStock');
const Order = require('../Models/Order');
const Prescription = require('../Models/Prescription');
const Notification = require('../Models/Notification');
const Patient = require('../Models/Patients');
const DeliveryMan = require('../Models/DeliveryMan')
const User = require('../Models/Users');
const mongoose = require('mongoose');

// Helper to get Pharmacy Profile by User ID
const getPharmacyByUserId = async (userId) => {
  return await Pharmacy.findOne({ userId });
};

// Alias used throughout the controller
const getPharmacy = getPharmacyByUserId;

/*exports.updateMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, price } = req.body;

    const pharmacy = await getPharmacyByUserId(req.user._id);
    const stock = await MedicineStock.findById(id);

    if (!stock || stock.pharmacyId.toString() !== pharmacy._id.toString())
      return res.status(403).json({ message: 'Not authorized or medicine not found' });

    const updated = await MedicineStock.findByIdAndUpdate(
      id,
      { quantity, price },
      { new: true, runValidators: true }
    );

    res.json({ message: 'Medicine updated successfully', updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete medicine from stock
exports.deleteMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const pharmacy = await getPharmacyByUserId(req.user._id);
    const stock = await MedicineStock.findById(id);

    if (!stock || stock.pharmacyId.toString() !== pharmacy._id.toString())
      return res.status(403).json({ message: 'Not authorized' });

    await MedicineStock.findByIdAndDelete(id);
    res.json({ message: 'Medicine deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Search for medicine across all pharmacies
exports.searchMedicines = async (req, res) => {
  try {
    const { name } = req.query;
    const results = await MedicineStock.find({
      medicineName: { $regex: new RegExp(name, 'i') },
      quantity: { $gt: 0 },
    }).populate('pharmacyId', 'licence registrationNumber');

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}; */

/*********************************************/

// GET DASHBOARD
exports.getDashboardStats = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });
    if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });

    const newPrescriptionsCount = await Prescription.countDocuments({
      suggestedPharmacies: pharmacy._id,
      status: "Pending"
    });

    const newOrdersCount = await Order.countDocuments({
      pharmacyId: pharmacy._id,
      status: "New"
    });

    const completedOrdersCount = await Order.countDocuments({
      pharmacyId: pharmacy._id,
      status: "Completed"
    });

    const lowStockItems = await MedicineStock.find({
      pharmacyId: pharmacy._id,
      $expr: { $lte: ["$quantity", "$minThreshold"] }
    }).select('medicineName quantity');

    const pendingOrders = await Order.find({
      pharmacyId: pharmacy._id,
      status: { $in: ["Preparing", "Ready"] }
    }).limit(5).populate('userId', 'name');



    res.json({
      stats: {
        newOrders: newOrdersCount,
        completed: completedOrdersCount,
        lowStock: lowStockItems.length,
        newPrescriptions: newPrescriptionsCount
      },
      lowStockDetails: lowStockItems,
      pendingOrders: pendingOrders
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};




// get new perciptions

/*exports.getNewPrescriptions = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    const prescriptions = await Prescription.find({
      suggestedPharmacies: pharmacy._id
    })
      .populate('patient', 'userId')
      .populate('doctor', 'userId')
      .sort({ createdAt: -1 });

    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};*/

/*exports.getPrescriptionDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    const prescription = await Prescription.findById(id)
      .populate({ path: 'patient', populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'doctor', populate: { path: 'userId', select: 'name' } });

    if (!prescription) return res.status(404).json({ message: 'Prescription not found' });

    const medicinesWithStatus = await Promise.all(prescription.medicines.map(async (med) => {
      const stockItem = await MedicineStock.findOne({
        pharmacyId: pharmacy._id,
        medicineName: new RegExp(med.name, 'i')
      });

      return {
        name: med.name,
        neededQuantity: med.quantity,
        availableQuantity: stockItem ? stockItem.quantity : 0,
        price: stockItem ? stockItem.price : 0,
        isInStock: stockItem && stockItem.quantity >= med.quantity
      };
    }));

    res.json({
      prescriptionInfo: prescription,
      medicinesStatus: medicinesWithStatus,
      summary: {
        subtotal: medicinesWithStatus.reduce((acc, curr) => acc + (curr.isInStock ? curr.price : 0), 0),
        delivery: pharmacy.deliveryFees || 15
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.confirmPrescriptionOrder = async (req, res) => {
  try {
    const { prescriptionId, items, total, deliveryAddress, patientUserId } = req.body;
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `PHX-${randomNum}`;

    const newOrder = await Order.create({
      pharmacyId: pharmacy._id,
      userId: req.body.userId,
      prescriptionId,
      orderNumber,
      items,
      totalPrice: total,
      deliveryAddress,
      paymentMethod: paymentMethod || "Cash",
      status: 'Preparing'
    });

    await Notification.create({
      recipient: patientUserId,
      title: "Order Confirmed",
      message: `Your order from ${pharmacy.pharmacyName} is being prepared`,
      type: 'order_status',
      relatedId: newOrder._id
    });

    res.status(201).json({ message: 'Order confirmed successfully', order: newOrder });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.findAlternative = async (req, res) => {
  try {
    const { category } = req.query;
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    const alternatives = await MedicineStock.find({
      pharmacyId: pharmacy._id,
      category: category,
      quantity: { $gt: 0 }
    }).limit(3);

    res.json(alternatives);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};*/


exports.patientSearch = async (req, res) => {
  try {
    let { query, lat, lng } = req.query;

    // 1. تحديد موقع المريض (من الطلب أو البروفايل)
    if (!lat || !lng) {
      const patientProfile = await Patient.findOne({ userId: req.user._id });
      if (patientProfile?.address?.location) {
        lng = patientProfile.address.location.coordinates[0];
        lat = patientProfile.address.location.coordinates[1];
      }
    }

    const longitude = parseFloat(lng || 0);
    const latitude = parseFloat(lat || 0);

    // 2. الـ Aggregation Pipeline
    const searchResults = await Pharmacy.aggregate([
      {
        // البحث الجغرافي
        $geoNear: {
          near: { type: "Point", coordinates: [longitude, latitude] },
          distanceField: "distance",
          maxDistance: 25000, // 25 كيلو
          spherical: true
        }
      },
      {
        // الربط الذكي: بيحل مشكلة الـ String vs ObjectId
        $lookup: {
          from: "medicinestocks",
          let: { pharmacy_id: "$_id" }, // بنأخد الـ ID بتاع الصيدلية
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    // هنا بنحول الـ pharmacyId اللي في جدول الأدوية لـ ObjectId عشان يقارنه صح
                    { $eq: ["$pharmacyId", { $toObjectId: "$$pharmacy_id" }] },
                    { $gt: ["$quantity", 0] }
                  ]
                }
              }
            }
          ],
          as: "inventory"
        }
      },
      {
        // فلترة النتائج النهائية: لازم الاسم يطابق أو يكون فيه أدوية في الـ inventory
        $match: {
          $or: [
            { pharmacyName: { $regex: query || "", $options: "i" } },
            { "inventory.medicineName": { $regex: query || "", $options: "i" } }
          ]
        }
      },
      {
        // تجهيز البيانات للـ UI
        $project: {
          pharmacyName: 1,
          rating: 1,
          deliveryAvailable: 1,
          distance: 1,
          totalMedicinesCount: { $size: "$inventory" },
          // فحص هل الدواء اللي المريض كتبه موجود فعلاً؟
          isMedicineAvailable: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$inventory",
                    as: "item",
                    cond: { $regexMatch: { input: "$$item.medicineName", regex: query || "", options: "i" } }
                  }
                }
              },
              0
            ]
          }
        }
      },
      { $sort: { isMedicineAvailable: -1, distance: 1 } }
    ]);

    res.json(searchResults);
  } catch (err) {
    console.error("Search Error:", err);
    res.status(500).json({ message: err.message });
  }
};


exports.getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate('pharmacyId', 'pharmacyName phone addresses');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    res.json({
      orderNumber: order.orderNumber,
      status: order.status,
      estimatedTime: order.estimatedTime,
      pharmacyName: order.pharmacyId.pharmacyName,
      pharmacyPhone: order.pharmacyId.phone,
      address: order.deliveryAddress,
      payment: order.paymentMethod,
      total: order.totalPrice,
      items: order.items
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



///////////////////////////////////////////////////////////////////////////////////
// get profile
//for pharmacy dashboard
exports.getProfile = async (req, res) => {
  try {
    // req.user.id جاي من الـ auth middleware
    const pharmacy = await Pharmacy.findOne({ userId: req.user.id });

    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: "Pharmacy not found"
      });
    }

    const pharmacyId = pharmacy._id;

    // ── Stats: عدد الأدوية, عدد الأوردرات الكلي ──────────────────────
    const [totalMedicines, totalOrders] = await Promise.all([
      MedicineStock.countDocuments({ pharmacyId }),
      Order.countDocuments({
        pharmacyId,
        status: "Completed"
      })
    ]);

    // ── Response ────────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        // Hero section
        pharmacyName: req.user.name,         // اسمه جاي من User model
        commercialRegisterNumber: pharmacy.commercialRegisterNumber,
        licenseExpiry: pharmacy.licenseExpiry,
        rating: pharmacy.rating,
        about: pharmacy.about,

        // Badges
        openNow: pharmacy.openNow,
        deliveryAvailable: pharmacy.deliveryAvailable,

        // Stats bar (3 أرقام تحت الـ hero)
        stats: {
          rating: pharmacy.rating,
          totalMedicines,
          totalOrders
        },

        // Pharmacy Details section
        phone: pharmacy.phone,
        workingHours: pharmacy.workingHours,    // [{ days, time }]
        addresses: pharmacy.addresses,        // [{ addressText, location }]
        deliveryArea: pharmacy.deliveryArea,     // ["Maadi", "Degla", ...]
        paymentMethods: pharmacy.paymentMethods,   // ["Cash", "Visa", ...]
        deliveryTime: pharmacy.deliveryTime,

        // Account Settings toggles
        settings: {
          deliveryAvailable: pharmacy.deliveryAvailable,
          openNow: pharmacy.openNow,
          prescriptionOnly: pharmacy.prescriptionOnly
        }
      }
    });

  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
//get all orders for dashboard
exports.getOrders = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user.id });
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { status, page = 1, limit = 20 } = req.query;

    const filter = { pharmacyId: pharmacy._id };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("userId", "name phone")         // اسم ورقم العميل
        .populate("items.medicineId", "medicineName")
        .populate("deliveryManId", "name phones vehicle")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      Order.countDocuments(filter)
    ]);

    // عدد كل status عشان الـ filter chips في الداشبورد
    const statusCounts = await Order.aggregate([
      { $match: { pharmacyId: pharmacy._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const counts = statusCounts.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      data: {
        orders,
        statusCounts: counts,         // { New: 5, Preparing: 2, ... }
        pagination: {
          total,
          page: Number(page),
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error("getOrders error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
//accept new order
exports.acceptOrder = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user.id });
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const order = await Order.findOne({
      _id: req.params.orderId,
      pharmacyId: pharmacy._id
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // لازم يكون New عشان يتقبل
    if (order.status !== "New") {
      return res.status(400).json({
        success: false,
        message: `Cannot accept an order with status "${order.status}"`
      });
    }

    order.status = "Preparing";
    order.statusHistory.push({
      status: "Preparing",
      changedAt: new Date(),
      note: "Order accepted by pharmacy"
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Order accepted successfully",
      data: {
        orderId: order._id,
        newStatus: order.status
      }
    });

  } catch (error) {
    console.error("acceptOrder error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.markOrderReady = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user.id });
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const order = await Order.findOne({
      _id: req.params.orderId,
      pharmacyId: pharmacy._id
    });

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // لازم يكون Preparing الأول
    if (order.status !== "Preparing") {
      return res.status(400).json({
        success: false,
        message: `Cannot mark ready an order with status "${order.status}"`
      });
    }

    // ── Delivery order: لازم يتبعتله delivery man ──────────────────────
    if (order.orderType === "Delivery") {
      const { deliveryManId } = req.body;

      if (!deliveryManId) {
        return res.status(400).json({
          success: false,
          message: "deliveryManId is required for delivery orders"
        });
      }

      const deliveryMan = await DeliveryMan.findOne({
        _id: deliveryManId,
        pharmacyId: pharmacy._id,
        isActive: true
      });

      if (!deliveryMan) {
        return res.status(404).json({
          success: false,
          message: "Delivery man not found or not active"
        });
      }

      if (deliveryMan.status === "Offline") {
        return res.status(400).json({
          success: false,
          message: `${deliveryMan.name} is offline and cannot be assigned`
        });
      }

      // لو كان معين لأوردر تاني قبل كده، شيل الأوردر ده من assignedOrders بتاعه
      if (order.deliveryManId) {
        await DeliveryMan.findByIdAndUpdate(order.deliveryManId, {
          $pull: { assignedOrders: order._id },
          $set: { status: "Available" }          // هنرجعه Available مبدئياً
        });
      }

      // assign الـ delivery man الجديد
      deliveryMan.assignedOrders.push(order._id);
      deliveryMan.status = "Busy";
      await deliveryMan.save();

      order.deliveryManId = deliveryMan._id;
    }

    // ── Mark as Ready ───────────────────────────────────────────────────
    order.status = "Ready";
    order.statusHistory.push({
      status: "Ready",
      changedAt: new Date(),
      note: order.orderType === "Delivery"
        ? "Order ready — rider assigned"
        : "Order ready for pickup"
    });

    await order.save();

    // Populate الـ response عشان الداشبورد يعرض اسم الـ delivery man
    await order.populate("deliveryManId", "name phones vehicle status");

    return res.status(200).json({
      success: true,
      message: "Order marked as ready",
      data: {
        orderId: order._id,
        newStatus: order.status,
        deliveryMan: order.deliveryManId ?? null
      }
    });

  } catch (error) {
    console.error("markOrderReady error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getInventory = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { filter = "all", page = 1, limit = 20 } = req.query;

    const baseFilter = { pharmacyId: pharmacy._id };

    if (filter === "instock") baseFilter.inStock = true;
    if (filter === "outofstock") baseFilter.inStock = false;

    const skip = (Number(page) - 1) * Number(limit);

    const [medicines, total, lowStockItems, outOfStockCount] = await Promise.all([
      MedicineStock.find(baseFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      MedicineStock.countDocuments(baseFilter),

      // Low stock section — quantity أقل من minThreshold وlازم inStock
      MedicineStock.find({
        pharmacyId: pharmacy._id,
        inStock: true,
        $expr: { $lte: ["$quantity", "$minThreshold"] }
      }).select("medicineName category quantity minThreshold price inStock"),

      MedicineStock.countDocuments({
        pharmacyId: pharmacy._id,
        inStock: false
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        medicines,
        lowStockItems,
        summary: {
          total,
          lowStockCount: lowStockItems.length,
          outOfStockCount
        },
        pagination: {
          total,
          page: Number(page),
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error("getInventory error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.searchMedicines = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { q, page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters"
      });
    }

    const skip = (Number(page) - 1) * Number(limit);

    // بنستخدم $text لو عندنا text index،
    // أو regex كـ fallback بيشمل الـ 3 fields
    let searchFilter;
    try {
      searchFilter = {
        pharmacyId: pharmacy._id,
        $text: { $search: q.trim() }
      };
      // test إن الـ index موجود بـ dry count
      await MedicineStock.countDocuments(searchFilter);
    } catch {
      // fallback لو الـ text index مش موجود
      const regex = new RegExp(q.trim(), "i");
      searchFilter = {
        pharmacyId: pharmacy._id,
        $or: [
          { medicineName: regex },
          { genericName: regex },
          { category: regex }
        ]
      };
    }

    const [medicines, total] = await Promise.all([
      MedicineStock.find(searchFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      MedicineStock.countDocuments(searchFilter)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        medicines,
        query: q,
        pagination: {
          total,
          page: Number(page),
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error("searchMedicines error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getLowStockAlerts = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const lowStockItems = await MedicineStock.find({
      pharmacyId: pharmacy._id,
      inStock: true,
      $expr: { $lte: ["$quantity", "$minThreshold"] }
    }).sort({ quantity: 1 }); // الأقل stock الأول

    return res.status(200).json({
      success: true,
      data: {
        count: lowStockItems.length,
        items: lowStockItems
      }
    });

  } catch (error) {
    console.error("getLowStockAlerts error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.restockMedicine = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { quantity } = req.body;

    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive number"
      });
    }

    const medicine = await MedicineStock.findOne({
      _id: req.params.id,
      pharmacyId: pharmacy._id
    });

    if (!medicine) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    const previousQuantity = medicine.quantity;
    medicine.quantity += Number(quantity);

    // لو كان out of stock وإتضاف كمية، رجّعه inStock تلقائي
    if (!medicine.inStock && medicine.quantity > 0) {
      medicine.inStock = true;
    }

    await medicine.save();

    return res.status(200).json({
      success: true,
      message: `${medicine.medicineName} restocked successfully`,
      data: {
        medicineId: medicine._id,
        medicineName: medicine.medicineName,
        previousQuantity,
        addedQuantity: Number(quantity),
        currentQuantity: medicine.quantity,
        inStock: medicine.inStock
      }
    });

  } catch (error) {
    console.error("restockMedicine error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.addMedicine = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const {
      medicineName,
      genericName,
      category,
      dosageForm,
      manufacturer,
      barcode,
      price,
      quantity,
      minThreshold,
      inStock,
      requiresPrescription,
      expiryDate,
      indications,
      sideEffects,
      dosageInstructions,
      notes,
      image
    } = req.body;

    // required fields check
    if (!medicineName || !category || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "medicineName, category, and price are required"
      });
    }

    // منعرفش نضيف نفس الدواء مرتين في نفس الصيدلية
    const existing = await MedicineStock.findOne({
      pharmacyId: pharmacy._id,
      medicineName: medicineName.trim()
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `"${medicineName}" already exists in your inventory. Use restock to add quantity.`
      });
    }

    const medicine = await MedicineStock.create({
      pharmacyId: pharmacy._id,
      medicineName: medicineName.trim(),
      genericName: genericName?.trim(),
      category,
      dosageForm,
      manufacturer,
      barcode,
      price: Number(price),
      quantity: Number(quantity) || 0,
      minThreshold: minThreshold !== undefined ? Number(minThreshold) : 5,
      inStock: inStock !== undefined ? inStock : true,
      requiresPrescription: requiresPrescription || false,
      expiryDate,
      indications,
      sideEffects,
      dosageInstructions,
      notes,
      image
    });

    return res.status(201).json({
      success: true,
      message: "Medicine added successfully",
      data: medicine
    });

  } catch (error) {
    console.error("addMedicine error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.updateMedicine = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    // الـ fields اللي مسموح بتعديلها — pharmacyId مش بيتغير أبداً
    const allowedFields = [
      "medicineName", "genericName", "category", "dosageForm",
      "manufacturer", "barcode", "price", "quantity", "minThreshold",
      "inStock", "requiresPrescription", "expiryDate",
      "indications", "sideEffects", "dosageInstructions", "notes", "image"
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update"
      });
    }

    // لو بيغير الـ quantity لـ 0 يبقى inStock false تلقائي
    if (updates.quantity !== undefined) {
      updates.quantity = Number(updates.quantity);
      if (updates.quantity <= 0 && updates.inStock === undefined) {
        updates.inStock = false;
      }
    }

    const medicine = await MedicineStock.findOneAndUpdate(
      { _id: req.params.id, pharmacyId: pharmacy._id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!medicine) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Medicine updated successfully",
      data: medicine
    });

  } catch (error) {
    console.error("updateMedicine error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.getDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [deliveryMen, total, statusCounts] = await Promise.all([
      DeliveryMan.find({ pharmacyId: pharmacy._id, isActive: true })
        .populate("assignedOrders", "orderNumber status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      DeliveryMan.countDocuments({ pharmacyId: pharmacy._id, isActive: true }),

      // عدد كل status عشان الـ stats row في الداشبورد
      DeliveryMan.aggregate([
        { $match: { pharmacyId: pharmacy._id, isActive: true } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ])
    ]);

    const counts = statusCounts.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, { Available: 0, Busy: 0, Offline: 0 });

    return res.status(200).json({
      success: true,
      data: {
        deliveryMen,
        summary: {
          total,
          available: counts.Available,
          busy: counts.Busy,
          offline: counts.Offline
        },
        pagination: {
          total,
          page: Number(page),
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error("getDeliveryMen error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.searchDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { q, page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters"
      });
    }

    const regex = new RegExp(q.trim(), "i");
    const skip = (Number(page) - 1) * Number(limit);

    const searchFilter = {
      pharmacyId: pharmacy._id,
      isActive: true,
      $or: [
        { name: regex },
        { phones: regex },   // phones هو array فـ mongoose بيعمل $elemMatch تلقائي
        { vehicle: regex }
      ]
    };

    const [deliveryMen, total] = await Promise.all([
      DeliveryMan.find(searchFilter)
        .populate("assignedOrders", "orderNumber status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      DeliveryMan.countDocuments(searchFilter)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        deliveryMen,
        query: q,
        pagination: {
          total,
          page: Number(page),
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error("searchDeliveryMen error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.getAvailableDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const deliveryMen = await DeliveryMan.find({
      pharmacyId: pharmacy._id,
      isActive: true,
      status: "Available"
    }).select("name phones vehicle status rating totalDeliveries");

    return res.status(200).json({
      success: true,
      data: {
        count: deliveryMen.length,
        deliveryMen
      }
    });

  } catch (error) {
    console.error("getAvailableDeliveryMen error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.getBusyDeliveryMen = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const deliveryMen = await DeliveryMan.find({
      pharmacyId: pharmacy._id,
      isActive: true,
      status: "Busy"
    })
      .populate("assignedOrders", "orderNumber status totalPrice createdAt")
      .select("name phones vehicle status rating totalDeliveries assignedOrders");

    return res.status(200).json({
      success: true,
      data: {
        count: deliveryMen.length,
        deliveryMen
      }
    });

  } catch (error) {
    console.error("getBusyDeliveryMen error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.addDeliveryMan = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { name, email, phones, vehicle, status, address, notes } = req.body;

    if (!name || !vehicle || !phones?.length) {
      return res.status(400).json({
        success: false,
        message: "name, vehicle, and at least one phone number are required"
      });
    }

    // منعرفش نضيف نفس الرقم مرتين في نفس الصيدلية
    const existingPhone = await DeliveryMan.findOne({
      pharmacyId: pharmacy._id,
      isActive: true,
      phones: { $in: phones }
    });

    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: "A delivery man with one of these phone numbers already exists"
      });
    }

    const deliveryMan = await DeliveryMan.create({
      pharmacyId: pharmacy._id,
      name: name.trim(),
      email: email?.trim().toLowerCase(),
      phones,
      vehicle,
      status: status || "Available",
      address,
      notes
    });

    return res.status(201).json({
      success: true,
      message: "Delivery man added successfully",
      data: deliveryMan
    });

  } catch (error) {
    console.error("addDeliveryMan error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.updateDeliveryMan = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const allowedFields = [
      "name", "email", "phones", "vehicle",
      "status", "address", "notes"
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update"
      });
    }

    // لو بيغير الـ phones لازم يتحقق من duplicate في الصيدلية دي
    if (updates.phones) {
      const existingPhone = await DeliveryMan.findOne({
        pharmacyId: pharmacy._id,
        isActive: true,
        _id: { $ne: req.params.id },   // مش نفس الـ document
        phones: { $in: updates.phones }
      });

      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: "A delivery man with one of these phone numbers already exists"
        });
      }
    }

    // لو بيغير status لـ Available لازم نشيل assignedOrders
    if (updates.status === "Available") {
      updates.assignedOrders = [];
    }

    const deliveryMan = await DeliveryMan.findOneAndUpdate(
      { _id: req.params.id, pharmacyId: pharmacy._id, isActive: true },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!deliveryMan) {
      return res.status(404).json({ success: false, message: "Delivery man not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Delivery man updated successfully",
      data: deliveryMan
    });

  } catch (error) {
    console.error("updateDeliveryMan error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.deleteDeliveryMan = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const deliveryMan = await DeliveryMan.findOne({
      _id: req.params.id,
      pharmacyId: pharmacy._id,
      isActive: true
    });

    if (!deliveryMan) {
      return res.status(404).json({ success: false, message: "Delivery man not found" });
    }

    // لو عنده أوردرات active منقدرش نحذفه
    if (deliveryMan.status === "Busy" && deliveryMan.assignedOrders.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${deliveryMan.name} has active orders and cannot be deleted. Change their status first.`
      });
    }

    // Soft delete — بنحتفظ بالـ record للـ history
    deliveryMan.isActive = false;
    deliveryMan.status = "Offline";
    await deliveryMan.save();

    return res.status(200).json({
      success: true,
      message: `${deliveryMan.name} has been removed successfully`
    });

  } catch (error) {
    console.error("deleteDeliveryMan error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id; // ← safe fallback
    const pharmacy = await getPharmacy(userId);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const allowedFields = [
      "phone",
      "about",
      "workingHours",       // [{ days, time }]
      "deliveryArea",       // ["Maadi", "Degla", ...]
      "deliveryTime",       // "30–45 min"
      "paymentMethods",     // ["Cash", "Visa", ...]
      "addresses",          // [{ addressText, location }]
      "licenseExpiry",
      "medicalLicencePdf"
    ];

    const pharmacyUpdates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) pharmacyUpdates[field] = req.body[field];
    });

    // اسم الصيدلية موجود في User model مش Pharmacy
    if (req.body.name !== undefined) {
      await User.findByIdAndUpdate(
        userId,                                  // ← use userId here too
        { $set: { name: req.body.name.trim() } },
        { runValidators: true }
      );
    }

    if (Object.keys(pharmacyUpdates).length === 0 && req.body.name === undefined) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update"
      });
    }

    // Before the Pharmacy.findOneAndUpdate call, sanitize addresses
    if (pharmacyUpdates.addresses) {
      pharmacyUpdates.addresses = pharmacyUpdates.addresses.map(addr => {
        // Only include location if coordinates are valid numbers
        const coords = addr.location?.coordinates;
        const hasValidCoords =
          Array.isArray(coords) &&
          coords.length === 2 &&
          coords.every(c => typeof c === "number" && isFinite(c));

        if (hasValidCoords) {
          return addr; // keep as-is
        }

        // Drop the location field entirely — just save the text
        const { location, ...addrWithoutLocation } = addr;
        return addrWithoutLocation;
      });
    }

    const updatedPharmacy = await Pharmacy.findOneAndUpdate(
      { userId: req.user.id },
      { $set: pharmacyUpdates },
      { new: true, runValidators: true }
    );

    // جيب الاسم من User عشان نرجعه في الـ response
    const user = await User.findById(userId).select("name");

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        pharmacyName: user.name,
        ...updatedPharmacy.toObject()
      }
    });

  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.toggleOpenStatus = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { openNow } = req.body;

    if (typeof openNow !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "openNow must be a boolean"
      });
    }

    // لو بيقفل الصيدلية وعنده delivery شغالة، يقفلها كمان
    const extraUpdates = {};
    if (!openNow && pharmacy.deliveryAvailable) {
      extraUpdates.deliveryAvailable = false;
    }

    const updatedPharmacy = await Pharmacy.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { openNow, ...extraUpdates } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: openNow ? "Pharmacy is now Open" : "Pharmacy is now Closed",
      data: {
        openNow: updatedPharmacy.openNow,
        deliveryAvailable: updatedPharmacy.deliveryAvailable
      }
    });

  } catch (error) {
    console.error("toggleOpenStatus error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.toggleDeliveryService = async (req, res) => {
  try {
    const pharmacy = await getPharmacy(req.user.id);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const { deliveryAvailable } = req.body;

    if (typeof deliveryAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "deliveryAvailable must be a boolean"
      });
    }

    // منقدرش نفتح delivery لو الصيدلية نفسها مقفولة
    if (deliveryAvailable && !pharmacy.openNow) {
      return res.status(400).json({
        success: false,
        message: "Cannot enable delivery service while pharmacy is closed"
      });
    }

    const updatedPharmacy = await Pharmacy.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { deliveryAvailable } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: deliveryAvailable
        ? "Delivery service is now enabled"
        : "Delivery service is now disabled",
      data: {
        openNow: updatedPharmacy.openNow,
        deliveryAvailable: updatedPharmacy.deliveryAvailable
      }
    });

  } catch (error) {
    console.error("toggleDeliveryService error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};