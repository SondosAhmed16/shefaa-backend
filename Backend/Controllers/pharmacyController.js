const Pharmacy = require('../Models/Pharmaces');
const MedicineStock = require('../Models/MedicineStock');

// Helper to get Pharmacy Profile by User ID
const getPharmacyByUserId = async (userId) => {
    return await Pharmacy.findOne({ userId });
};

// 1. Get all medicine stock for the logged-in pharmacy
exports.getStock = async (req, res) => {
  try {
    const pharmacy = await getPharmacyByUserId(req.user._id);
    if (!pharmacy) return res.status(404).json({ message: 'Pharmacy profile not found' });

    const stock = await MedicineStock.find({ pharmacyId: pharmacy._id });
    res.json(stock);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. Add new medicine to stock
exports.addMedicine = async (req, res) => {
  try {
    const { medicineName, quantity, price, expirationDate, category, description } = req.body;

    const pharmacy = await getPharmacyByUserId(req.user._id);
    if (!pharmacy) return res.status(404).json({ message: 'Pharmacy profile not found' });

    const existing = await MedicineStock.findOne({ pharmacyId: pharmacy._id, medicineName });
    if (existing)
      return res.status(400).json({ message: 'Medicine already exists, use update instead' });

    const newMedicine = await MedicineStock.create({
      pharmacyId: pharmacy._id,
      medicineName,
      quantity,
      price,
      expirationDate,
      category,
      description
    });

    res.status(201).json({ message: 'Medicine added successfully', newMedicine });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Update medicine quantity or price
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

// 4. Delete medicine from stock
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

// 5. Search for medicine across all pharmacies
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

// 6. Dispense medicine (Reduce quantity)
exports.dispenseMedicine = async (req, res) => {
  try {
    const { stockId, quantityToDispense } = req.body;
    const pharmacy = await getPharmacyByUserId(req.user._id);
    
    const stock = await MedicineStock.findById(stockId);
    if (!stock || stock.pharmacyId.toString() !== pharmacy._id.toString())
      return res.status(403).json({ message: 'Not authorized' });

    if (stock.quantity < quantityToDispense)
      return res.status(400).json({ message: 'Not enough stock' });

    stock.quantity -= quantityToDispense;
    await stock.save();

    res.json({ message: 'Medicine dispensed successfully', remainingQuantity: stock.quantity });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};