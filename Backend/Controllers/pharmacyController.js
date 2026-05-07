const Pharmacy = require('../Models/Pharmaces');
const MedicineStock = require('../Models/MedicineStock');
const Order = require('../Models/Order');
const Prescription = require('../Models/Prescription');
const Notification = require('../Models/Notification');

// Helper to get Pharmacy Profile by User ID
const getPharmacyByUserId = async (userId) => {
  return await Pharmacy.findOne({ userId });
};

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

// get profile
exports.getProfile = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    if (!pharmacy) {
      return res.status(404).json({ message: 'Pharmacy profile not found' });
    }

    res.json(pharmacy);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// UPDATE PROFILE 

exports.updateProfileSettings = async (req, res) => {
  try {
    const { 
      deliveryAvailable, 
      openNow, 
      prescriptionOnly,
      deliveryTime,
      deliveryArea,
      paymentMethods,
      phone,
      about,
      workingHours,
      commercialRegisterNumber,
      licenseExpiry 
    } = req.body;

    const updatedPharmacy = await Pharmacy.findOneAndUpdate(
      { userId: req.user._id },
      { 
        deliveryAvailable, 
        openNow, 
        prescriptionOnly,
        deliveryTime,
        deliveryArea,
        paymentMethods,
        phone,
        about,
        workingHours,
        commercialRegisterNumber,
        licenseExpiry
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedPharmacy) return res.status(404).json({ message: 'Pharmacy not found' });

    res.json(updatedPharmacy);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



// get new perciptions

exports.getNewPrescriptions = async (req, res) => {
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
};

// get inventory

exports.getInventory = async (req, res) => {
  try {
    const pharmacy = await getPharmacyByUserId(req.user._id);
    if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });

    const { search, filter } = req.query;

    const lowStockAlerts = await MedicineStock.find({
      pharmacyId: pharmacy._id,
      quantity: { $gt: 0 }, 
      $expr: { $lte: ["$quantity", "$minThreshold"] }
    }).sort({ quantity: 1 });

    let allMedicationsQuery = { pharmacyId: pharmacy._id };

    if (filter === 'low') {
      allMedicationsQuery.quantity = { $gt: 0 }; 
      allMedicationsQuery.$expr = { $lte: ["$quantity", "$minThreshold"] };
    } else if (filter === 'out') {
      allMedicationsQuery.quantity = 0; 
    }

    if (search) {
      allMedicationsQuery.medicineName = { $regex: search, $options: 'i' };
    }

    const allMedications = await MedicineStock.find(allMedicationsQuery).sort({ createdAt: -1 });

    res.json({
      lowStockAlerts,
      allMedications
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// add medicine

exports.addMedicine = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });
    
    const { 
      medicineName, 
      category, 
      price, 
      quantity, 
      minThreshold, 
      requiresPrescription 
    } = req.body;

    const newMedicine = new MedicineStock({
      pharmacyId: pharmacy._id,
      medicineName,
      category,
      price,
      quantity,
      minThreshold,
      requiresPrescription: requiresPrescription || false
    });

    await newMedicine.save();
    res.status(201).json({ message: 'Medicine added successfully', medicine: newMedicine });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



exports.getPrescriptionDetails = async (req, res) => {
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
};

exports.getOrders = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });
    const { status } = req.query;

    let query = { pharmacyId: pharmacy._id };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('userId', 'name')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true }
    );
    await Notification.create({
      recipient: updatedOrder.userId,
      title: "Order Status Updated",
      message: `Your order ${updatedOrder.orderNumber} is now ${status}`,
      type: 'order_status',
      relatedId: updatedOrder._id
    });

    res.json({ message: `Order status updated to ${status}`, updatedOrder });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.searchWithAvailability = async (req, res) => {
  try {
    const { lng, lat, query } = req.query;

    if (!lng || !lat) {
      return res.status(400).json({ message: "Location coordinates are required." });
    }

    const results = await Pharmacy.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          distanceField: "distance",
          spherical: true,
          distanceMultiplier: 0.001,
          maxDistance: 10000
        }
      },
      {
        $lookup: {
          from: "medicinestocks",
          localField: "_id",
          foreignField: "pharmacyId",
          as: "inventory"
        }
      },
      {
        $addFields: {
          isAvailable: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$inventory",
                    as: "item",
                    cond: {
                      $and: [
                        { $regexMatch: { input: "$$item.medicineName", regex: query || "", options: "i" } },
                        { $gt: ["$$item.quantity", 0] }
                      ]
                    }
                  }
                }
              },
              0
            ]
          }
        }
      },
      {
        $project: {
          pharmacyName: 1,
          rating: 1,
          openNow: 1,
          deliveryAvailable: 1,
          distance: { $round: ["$distance", 1] },
          isAvailable: 1,
          "addresses.addressText": 1
        }
      }
    ]);

    res.json(results);
  } catch (err) {
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

exports.updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    const stock = await MedicineStock.findByIdAndUpdate(id, { quantity }, { new: true });

    if (stock.quantity <= stock.minThreshold) {
      await Notification.create({
        recipient: req.user._id,
        title: `Low stock alert — ${stock.medicineName}`,
        message: `Only ${stock.quantity} items left in stock.`,
        type: 'low_stock',
        relatedId: stock._id
      });
    }

    res.json(stock);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};