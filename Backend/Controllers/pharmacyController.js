const Pharmacy = require('../Models/Pharmaces');
const MedicineStock = require('../Models/MedicineStock');
const Order = require('../Models/Order');
const Prescription = require('../Models/Prescription');

// Helper to get Pharmacy Profile by User ID
const getPharmacyByUserId = async (userId) => {
  return await Pharmacy.findOne({ userId });
};

exports.updateMedicine = async (req, res) => {
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
};

/*********************************************/

// GET DASHBOARD
exports.getDashboardStats = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });
    if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });

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
        lowStock: lowStockItems.length
      },
      lowStockDetails: lowStockItems,
      pendingOrders: pendingOrders
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// UPDATE PROFILE 

exports.updateProfileSettings = async (req, res) => {
  try {
    const { deliveryAvailable, openNow, prescriptionOnly } = req.body;
    const updatedPharmacy = await Pharmacy.findOneAndUpdate(
      { userId: req.user._id },
      { deliveryAvailable, openNow, prescriptionOnly },
      { new: true }
    );
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

exports.getInventory = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });
    
    const allMedicines = await MedicineStock.find({ pharmacyId: pharmacy._id });

    const lowStock = allMedicines.filter(m => m.quantity > 0 && m.quantity <= m.minThreshold);
    const outOfStock = allMedicines.filter(m => m.quantity === 0);

    res.json({
      totalItems: allMedicines.length, 
      lowStockCount: lowStock.length, 
      allMedicines,
      lowStockAlerts: lowStock,
      outOfStock
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addMedicine = async (req, res) => {
  try {
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });
    const { medicineName, category, price, quantity, requiresPrescription } = req.body;
    
    const newMedicine = new MedicineStock({
      pharmacyId: pharmacy._id,
      medicineName,
      category,
      price,
      quantity,
      requiresPrescription 
    });

    await newMedicine.save();
    res.status(201).json(newMedicine);
  } catch (err) {
    res.status(400).json({ message: err.message });
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
    const { prescriptionId, items, total } = req.body;
    const pharmacy = await Pharmacy.findOne({ userId: req.user._id });

    const newOrder = await Order.create({
      pharmacyId: pharmacy._id,
      prescriptionId,
      items, 
      totalPrice: total,
      status: 'Preparing' 
    });

    res.status(201).json({ message: 'Order confirmed successfuly ', order: newOrder });
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

    res.json({ message: `Order status updated to ${status}`, updatedOrder });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};