const mongoose = require('mongoose');
const Patient = require('../Models/Patients');
const Appointment = require('../Models/Appointment');
const MedicalRecord = require('../Models/MedicalRecord');
const Notification = require('../Models/Notification');
const Pharmacy = require('../Models/Pharmaces');
const Order = require('../Models/Order');
const MedicineStock = require('../Models/MedicineStock');
const LabRequest = require('../Models/LabRequest');
const Lab = require('../Models/Labs');
const Service = require('../Models/Services');
const User = require('../Models/Users');
const Transaction = require("../Models/Transaction");
const getPatientByUserId = async (userId) => {
  return await Patient.findOne({ userId: userId });
};

exports.getProfile = async (req, res) => {
  try {
    const patient = await Patient.findOne({ userId: req.user._id }).populate('userId', 'name email');
    if (!patient) return res.status(404).json({ message: 'Patient profile not found' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const {
      addressText,
      lng,
      lat, phoneNumber, age, gender,
      bloodType, allergies, height, weight,
      chronicConditions
    } = req.body;

    if (allergies && !Array.isArray(allergies)) {
      return res.status(400).json({
        message: "Allergies must be a list of selected items."
      });
    }

    if (chronicConditions && !Array.isArray(chronicConditions)) {
      return res.status(400).json({
        message: "Chronic conditions must be a list of selected items."
      });
    }

    const updateFields = {};

    if (phoneNumber !== undefined) updateFields.phoneNumber = phoneNumber;
    if (age !== undefined) updateFields.age = age;
    if (gender !== undefined) updateFields.gender = gender;
    if (bloodType !== undefined) updateFields.bloodType = bloodType;
    if (allergies !== undefined) updateFields.allergies = allergies;
    if (height !== undefined) updateFields.height = height;
    if (weight !== undefined) updateFields.weight = weight;
    if (chronicConditions !== undefined) updateFields.chronicConditions = chronicConditions;

    if (addressText !== undefined || lng !== undefined || lat !== undefined) {
      updateFields.address = {
        ...(addressText !== undefined && { addressText }),
        ...(lng !== undefined && lat !== undefined && {
          location: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)]
          }
        })
      };
    }

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!patient) return res.status(404).json({ message: 'Patient profile not found' });

    res.json({
      message: 'Profile updated successfully',
      patient
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateBasicInfo = async (req, res) => {
  try {
    const { name, address, phoneNumber, age, gender, height, weight } = req.body;

    if (name) {
      await User.findByIdAndUpdate(req.user._id, { name });
    }

    // ── نظف الـ coordinates لو جت غلط ──────────────────────────────
    let cleanAddress = address;
    if (address?.location?.coordinates) {
      const coords = address.location.coordinates;
      const valid = Array.isArray(coords) && coords.length === 2 &&
        coords.every(c => typeof c === "number" && isFinite(c));
      if (!valid) {
        cleanAddress = { ...address, location: { type: "Point", coordinates: [] } };
      }
    }

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { address: cleanAddress, phoneNumber, age, gender, height, weight },
      { new: true, runValidators: true }
    );

    if (!patient) return res.status(404).json({ message: 'Patient profile not found' });

    res.json({
      message: 'Basic info updated successfully',
      updatedData: { name, address: cleanAddress, phoneNumber, age, gender, height, weight }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateMedicalInfo = async (req, res) => {
  try {
    const { bloodType, allergies, chronicConditions } = req.body;

    if (allergies && !Array.isArray(allergies)) return res.status(400).json({ message: "Allergies must be a list." });

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { bloodType, allergies, chronicConditions },
      { new: true, runValidators: true }
    );

    if (!patient) return res.status(404).json({ message: 'Patient profile not found' });
    res.json({ message: 'Medical info updated', patient });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const patient = await getPatientByUserId(req.user._id);

    const record = await MedicalRecord.create({
      patientId: patient._id,
      doctorId: req.body.doctorId || null,
      diagnosis: req.body.diagnosis || 'Self-uploaded attachment',
      attachments: [{
        fileName: req.file.originalname,
        fileUrl: req.file.path
      }],
      visitDate: new Date(),
      notes: req.body.notes || 'Uploaded by patient'
    });

    res.json({ message: 'File uploaded successfully to Cloudinary', fileUrl: req.file.path, record });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMedicalHistory = async (req, res) => {
  try {
    const patient = await getPatientByUserId(req.user._id);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const records = await MedicalRecord.find({ patientId: patient._id })
      .populate('doctorId', 'name');

    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// get his medication
exports.getMedications = async (req, res) => {
  try {
    const patient = await Patient.findOne({ userId: req.user._id });
    res.json(patient.medications || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// add his medication
exports.addMedication = async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate && new Date(startDate) < today) {
      return res.status(400).json({ message: "Start date cannot be in the past." });
    }

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ message: "End date cannot be before start date." });
    }

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { $push: { medications: req.body } },
      { new: true }
    );

    const addedMedication = patient.medications[patient.medications.length - 1];

    await Notification.create({
      recipient: req.user._id,
      title: "new medication",
      message: `you added ${name} to your medication list successfully`,
      type: 'medication'
    });

    res.json({
      message: "Medication added",
      medication: addedMedication
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.confirmMedicationDose = async (req, res) => {
  try {
    const { medId } = req.params;
    const now = new Date();

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id, "medications._id": medId },
      {
        $push: {
          "medications.$.adherenceHistory": {
            date: now,
            status: 'taken'
          }
        }
      },
      { new: true }
    );

    if (!patient) return res.status(404).json({ message: "Medication not found" });

    const med = patient.medications.id(medId);


    const takenDoses = med.adherenceHistory.length;


    const totalExpectedDoses = 10;

    let adherenceRate = Math.round((takenDoses / totalExpectedDoses) * 100);

    if (adherenceRate > 100) adherenceRate = 100;

    res.json({
      message: "Dose confirmed!",
      adherenceRate: `${adherenceRate}%`,
      medication: med
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// update patient medication
exports.updateMedication = async (req, res) => {
  try {
    const { medId } = req.params;

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id, "medications._id": medId },
      {
        $set: {
          "medications.$": { ...req.body, _id: medId }
        }
      },
      { new: true, runValidators: true }
    );

    if (!patient) return res.status(404).json({ message: "Medication or Patient not found" });

    const updatedMedication = patient.medications.id(medId);

    await Notification.create({
      recipient: req.user._id,
      title: "Medication Updated",
      message: `You updated ${req.body.name || 'a medication'} successfully.`,
      type: 'medication'
    });

    res.json({
      message: "Medication updated successfully",
      medication: updatedMedication
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// delete patient medication

exports.deleteMedication = async (req, res) => {
  try {
    const { medId } = req.params;

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { medications: { _id: new mongoose.Types.ObjectId(medId) } } },
      { new: false } 
    );

    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const deletedMedication = patient.medications.id(medId);

    if (!deletedMedication) {
      return res.status(404).json({ message: "Medication not found" });
    }

    await Notification.create({
      recipient: req.user._id,
      title: "Medication Removed",
      message: `A medication has been removed from your list.`,
      type: 'medication'
    });

    res.json({
      message: "Medication deleted successfully",
      medication: deletedMedication
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/*exports.deleteMedication = async (req, res) => {
  try {
    const { medId } = req.params;

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { $pull: { medications: { _id: medId } } },
      { new: false }
    );

    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const deletedMedication = patient.medications.id(medId);

    await Notification.create({
      recipient: req.user._id,
      title: "Medication Removed",
      message: `A medication has been removed from your list.`,
      type: 'medication'
    });

    res.json({
      message: "Medication deleted successfully",
      medication: deletedMedication
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};*/

exports.getMyMedications = async (req, res) => {
  try {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const now = new Date();
    const activeMedications = patient.medications.filter(med => {
      if (!med.endDate) return true;
      return new Date(med.endDate) >= now;
    });

    let totalAdherenceSum = 0;

    const medicationsList = activeMedications.map(med => {
      const start = new Date(med.startDate);
      const endForCalc = med.endDate && new Date(med.endDate) < now ? new Date(med.endDate) : now;

      const diffTime = Math.abs(endForCalc - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

      const expectedDoses = diffDays * med.timesPerDay;
      const takenDoses = med.adherenceHistory.filter(h => h.status === 'taken').length;

      const medAdherence = expectedDoses > 0
        ? Math.round((takenDoses / expectedDoses) * 100)
        : 0;

      const finalMedAdherence = medAdherence > 100 ? 100 : medAdherence;

      totalAdherenceSum += finalMedAdherence;

      return {
        _id: med._id,
        name: med.name,
        dosage: med.dosage,
        form: med.form,
        timesPerDay: med.timesPerDay,
        schedule: med.schedule,
        startDate: med.startDate,
        endDate: med.endDate,
        isActive: med.isActive,
        adherencePercentage: finalMedAdherence,
        adherenceHistory: med.adherenceHistory
      };
    });

    const activeCount = medicationsList.length;
    const avgAdherence = activeCount > 0
      ? Math.round(totalAdherenceSum / activeCount)
      : 0;

    res.json({
      stats: {
        avgAdherence: `${avgAdherence}%`,
        activeMedications: activeCount
      },
      medications: medicationsList
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// for pharmecies 
exports.searchPharmaciesAndMedicines = async (req, res) => {
  try {
    const { query, type } = req.query; // type: 'pharmacy' أو 'medicine'

    const patient = await Patient.findOne({ userId: req.user.id });
    const coords = patient?.address?.location?.coordinates;
    if (!patient || !coords || coords.length < 2 || !coords.every(c => typeof c === "number" && isFinite(c))) {
      return res.status(400).json({
        success: false,
        message: "Patient location is required. Please update your profile location."
      });
    }

    const [longitude, latitude] = patient.address.location.coordinates;

    let pipeline = [
      {
        $geoNear: {
          near: { type: "Point", coordinates: [longitude, latitude] },
          distanceField: "distance",
          spherical: true,
          query: { openNow: true, visibilityStatus: "active" }   // ← ضفنا دي
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" }
    ];

    if (type === 'pharmacy' && query) {
      pipeline.push({
        $match: {
          "userInfo.name": { $regex: query, $options: "i" }
        }
      });
    } else if (type === 'medicine' && query) {

      const matchingStocks = await MedicineStock.find({
        $or: [
          { medicineName: { $regex: query, $options: "i" } },
          { genericName: { $regex: query, $options: "i" } }
        ],
        quantity: { $gt: 0 },
        inStock: true
      }).select('pharmacyId');

      const pharmacyIds = matchingStocks.map(stock => stock.pharmacyId);

      pipeline.push({
        $match: {
          _id: { $in: pharmacyIds }
        }
      });
    }

    pipeline.push({
      $lookup: {
        from: "medicinestocks",
        let: { pharmacyId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$pharmacyId", "$$pharmacyId"] },
              quantity: { $gt: 0 },
              inStock: true
            }
          },
          { $count: "availableCount" }
        ],
        as: "medicineCountArray"
      }
    });

    pipeline.push({
      $project: {
        _id: 1,
        pharmacyName: "$userInfo.name",
        phone: 1,
        rating: 1,
        deliveryTime: 1,
        addresses: 1,
        distanceKm: {
          $round: [{ $divide: ["$distance", 1000] }, 1]
        },
        availableMedicinesCount: {
          $ifNull: [{ $arrayElemAt: ["$medicineCountArray.availableCount", 0] }, 0]
        }
      }
    });

    const results = await Pharmacy.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });

  } catch (error) {
    console.error("Error in Patient Pharmacy Search:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};


exports.getPharmacyProfileForPatient = async (req, res) => {
  try {
    const { id } = req.params;

    const pharmacy = await Pharmacy.findById(id).populate('userId', 'name email');
    if (!pharmacy || pharmacy.visibilityStatus !== "active") {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    const availableMedicinesCount = await MedicineStock.countDocuments({
      pharmacyId: id,
      quantity: { $gt: 0 },
      inStock: true
    });

    const profileData = {
      _id: pharmacy._id,
      pharmacyName: pharmacy.userId ? pharmacy.userId.name : "Unknown Pharmacy",
      openNow: pharmacy.openNow,
      alwaysOpen: pharmacy.alwaysOpen || false,
      rating: pharmacy.rating || 0,
      totalReviews: pharmacy.totalReviews || 0,
      deliveryTime: pharmacy.deliveryTime,
      deliveryFee: pharmacy.deliveryFee || 0,
      minimumOrder: pharmacy.minimumOrder || 0,
      phone: pharmacy.phone,
      about: pharmacy.about,
      services: pharmacy.services || [],
      workingHours: pharmacy.workingHours,
      addressText: pharmacy.addresses.length > 0 ? pharmacy.addresses[0].addressText : "",
      location: pharmacy.addresses.length > 0 ? pharmacy.addresses[0].location : null,
      availableMedicinesCount: availableMedicinesCount
    };

    return res.status(200).json({ success: true, data: profileData });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getPharmacyMedicinesForPatient = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, search, page = 1, limit = 10 } = req.query;

    const pharmacy = await Pharmacy.findById(id);
    if (!pharmacy || pharmacy.visibilityStatus !== "active") {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    let filter = {
      pharmacyId: id,
      quantity: { $gt: 0 },
      inStock: true
    };

    if (category && category !== 'all') {
      filter.category = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    if (search) {
      filter.$or = [
        { medicineName: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalMedicines = await MedicineStock.countDocuments(filter);

    const medicines = await MedicineStock.find(filter)
      .select('medicineName category price requiresPrescription quantity dosageForm genericName')
      .skip(skip)
      .limit(parseInt(limit));

    const mostOrderedMedicines = await MedicineStock.find({
      pharmacyId: id,
      quantity: { $gt: 0 },
      inStock: true
    })
      .sort({ quantity: -1 })
      .limit(5)
      .select('medicineName category price requiresPrescription dosageForm');

    return res.status(200).json({
      success: true,
      data: {
        medicines,
        mostOrdered: mostOrderedMedicines,
        pagination: {
          total: totalMedicines,
          page: parseInt(page),
          pages: Math.ceil(totalMedicines / parseInt(limit))
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/*exports.checkoutCart = async (req, res) => {
  try {
    const { pharmacyId, items, orderType, paymentMethod, deliveryAddress } = req.body;

    const pharmacy = await Pharmacy.findById(pharmacyId);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    if (!pharmacy.openNow) {
      return res.status(400).json({ success: false, message: "Cannot place order, pharmacy is currently closed" });
    }

    let subtotal = 0;
    let validatedItems = [];

    // التحقق من المخزون والأسعار لكل دواء في الكارت
    for (const item of items) {
      const stock = await MedicineStock.findOne({ _id: item.medicineId, pharmacyId });
      if (!stock || !stock.inStock || stock.quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Medicine ${stock ? stock.medicineName : 'Unknown'} is out of stock or insufficient quantity`
        });
      }

      subtotal += stock.price * item.quantity;
      validatedItems.push({
        medicineId: item.medicineId,
        quantity: item.quantity,
        price: stock.price // تسجيل السعر الحالي
      });
    }

    // التحقق من الحد الأدنى للطلب للصيدلية
    if (subtotal < pharmacy.minimumOrder) {
      return res.status(400).json({
        success: false,
        message: `Order total must be at least ${pharmacy.minimumOrder} EGP for this pharmacy`
      });
    }

    const deliveryFee = orderType === "Delivery" ? (pharmacy.deliveryFee || 0) : 0;
    const totalPrice = subtotal + deliveryFee;

    // توليد رقم طلب فريد
    const orderNumber = `PHX-${Math.floor(1000 + Math.random() * 9000)}`;

    const newOrder = new Order({
      pharmacyId,
      userId: req.user._id, // من الـ auth middleware
      orderNumber,
      orderType,
      items: validatedItems,
      subtotal,
      deliveryFee,
      totalPrice,
      paymentMethod,
      deliveryAddress: orderType === "Delivery" ? deliveryAddress : undefined,
      statusHistory: [{ status: "New", note: "Order placed successfully" }]
    });

    await newOrder.save();

    // تحديث المخزون (خصم الكميات المحجوزة)
    for (const item of validatedItems) {
      await MedicineStock.findByIdAndUpdate(item.medicineId, {
        $inc: { quantity: -item.quantity }
      });
    }

    return res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      order: newOrder
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};*/

exports.getMedicineDetailsForPatient = async (req, res) => {
  try {
    const { medId } = req.params;

    const medicine = await MedicineStock.findById(medId).populate({
      path: 'pharmacyId',
      populate: { path: 'userId', select: 'name' }
    });

    if (!medicine) {
      return res.status(404).json({ success: false, message: "Medicine not found" });
    }

    const medicineDetails = {
      _id: medicine._id,
      medicineName: medicine.medicineName,
      category: medicine.category,
      price: medicine.price,
      dosageForm: medicine.dosageForm,
      requiresPrescription: medicine.requiresPrescription,

      inStock: medicine.inStock && medicine.quantity > 0,
      availableQuantity: medicine.quantity,

      medicineInfo: {
        brandName: medicine.medicineName,
        concentration: medicine.concentration || "N/A",
        form: medicine.dosageForm,
        manufacturer: medicine.manufacturer || "N/A",
        prescription: medicine.requiresPrescription ? "Required" : "Not Required",
        shelf: medicine.notes || "General Shelf"
      },

      usageInstructions: {
        indications: medicine.indications || "No description available",
        sideEffects: medicine.sideEffects || "None reported",
        dosageInstructions: medicine.dosageInstructions || "Take as directed by your doctor."
      },

      pharmacyName: medicine.pharmacyId?.userId?.name || "Unknown Pharmacy"
    };

    return res.status(200).json({
      success: true,
      data: medicineDetails
    });

  } catch (error) {
    console.error("Error fetching medicine details:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};



exports.createOrder = async (req, res) => {
  try {
    const userId = req.user._id; 
    const {
      pharmacyId,
      items,
      orderType, 
      paymentMethod, 
      deliveryAddressDetails 
    } = req.body;

    const pharmacy = await Pharmacy.findById(pharmacyId);
    if (!pharmacy) {
      return res.status(404).json({ success: false, message: "Pharmacy not found" });
    }

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const medicine = await MedicineStock.findOne({ _id: item.medicineId, pharmacyId });
      if (!medicine || medicine.quantity < item.quantity || !medicine.inStock) {
        return res.status(400).json({
          success: false,
          message: `Medicine ${item.medicineName || 'requested'} is out of stock or unavailable.`
        });
      }

      const itemPrice = medicine.price;
      subtotal += itemPrice * item.quantity;

      orderItems.push({
        medicineId: medicine._id,
        quantity: item.quantity,
        price: itemPrice 
      });
    }

    let deliveryFee = 0;
    let finalShippingAddress = null;

    if (orderType === "Delivery") {
      deliveryFee = pharmacy.deliveryFee || 0;

      if (!deliveryAddressDetails || !deliveryAddressDetails.streetAddress) {
        return res.status(400).json({
          success: false,
          message: "Delivery address details are required for Delivery orders."
        });
      }

      finalShippingAddress = {
        addressText: `${deliveryAddressDetails.cityDistrict}, ${deliveryAddressDetails.streetAddress}`, 
        fullName: deliveryAddressDetails.fullName,
        phoneNumber: deliveryAddressDetails.phoneNumber,
        cityDistrict: deliveryAddressDetails.cityDistrict,
        streetAddress: deliveryAddressDetails.streetAddress,


        ...(deliveryAddressDetails.location &&
          deliveryAddressDetails.location.coordinates &&
          deliveryAddressDetails.location.coordinates.length === 2
          ? {
            location: {
              type: "Point",
              coordinates: [
                Number(deliveryAddressDetails.location.coordinates[0]),
                Number(deliveryAddressDetails.location.coordinates[1])
              ]
            }
          }
          : { location: undefined })
      };
    } else if (orderType === "Pickup") {
      deliveryFee = 0;
      finalShippingAddress = null;
    } else {
      return res.status(400).json({ success: false, message: "Invalid order type. Must be Delivery or Pickup." });
    }

    const discount = 0; 
    const totalPrice = subtotal + deliveryFee - discount;

    const orderNumber = `SHF-${Math.floor(100000 + Math.random() * 900000)}`;


    const CASH_METHODS = ["Cash"];
    const paymentStatus = CASH_METHODS.includes(paymentMethod) ? "Pending" : "Paid";

    const newOrder = new Order({
      pharmacyId,
      userId,
      orderNumber,
      orderType,
      status: "New",
      statusHistory: [{ status: "New", note: `Order placed successfully as ${orderType}` }],
      items: orderItems,
      subtotal,
      deliveryFee,
      discount,
      totalPrice,
      paymentMethod,
      paymentStatus,
      deliveryAddress: finalShippingAddress 
    });

    await newOrder.save();

    for (const item of items) {
      await MedicineStock.findByIdAndUpdate(item.medicineId, {
        $inc: { quantity: -item.quantity }
      });
    }

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: {
        orderId: newOrder._id,
        orderNumber: newOrder.orderNumber,
        orderType: newOrder.orderType,
        pharmacyName: pharmacy.userId?.name || "Shefaa Pharmacy", 
        deliveryTime: orderType === "Delivery" ? (pharmacy.deliveryTime || "1 h") : "N/A (Pickup)",
        itemsCount: orderItems.reduce((acc, item) => acc + item.quantity, 0),
        subtotal: newOrder.subtotal,
        deliveryFee: newOrder.deliveryFee,
        totalPrice: newOrder.totalPrice,
        paymentMethod: newOrder.paymentMethod
      }
    });

  } catch (err) {
    console.error("Error in createOrder:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};


exports.processOnlinePayment = async (req, res) => {
  try {
    const { orderId, cardholderName, cardNumber, expiryDate, cvv } = req.body;

    if (!cardholderName || !cardNumber || !expiryDate || !cvv) {
      return res.status(400).json({
        success: false,
        message: "All card details (Name, Number, Expiry, CVV) are required."
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.paymentStatus === "Paid") {
      return res.status(400).json({ success: false, message: "This order is already paid." });
    }

    order.paymentStatus = "Paid";

    order.statusHistory.push({
      status: order.status,
      note: "Payment completed successfully via Online Card"
    });

    await order.save();


    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    await mongoose.model('BillingRecord').findOneAndUpdate(
      { entity: order.pharmacyId, month: currentMonth, year: currentYear },
      {
        $inc: {
          totalRevenue: order.subtotal,
          activityCount: 1
        }
      },
      { upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Payment processed successfully! Your order is being prepared.",
      data: {
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        totalPaid: order.totalPrice
      }
    });

  } catch (err) {
    console.error("Error in processOnlinePayment:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};


exports.getPatientOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate({
        path: 'pharmacyId',
        populate: { path: 'userId', select: 'name' }
      })
      .populate('deliveryManId')
      .populate('items.medicineId', 'medicineName');

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const timeline = {
      orderConfirmed: {
        title: "Order Confirmed",
        description: "Your order was received and processed",
        time: null,
        isCompleted: false
      },
      pharmacyPreparing: {
        title: "Pharmacy Preparing Order",
        description: `Pharmacy [${order.pharmacyId?.userId?.name || 'Shefaa Pharmacy'}] is preparing your medications`,
        time: null,
        isCompleted: false
      },
      riderPickedUp: {
        title: "Rider Picked Up Order",
        description: order.deliveryManId
          ? `Rider [${order.deliveryManId.name}] picked up your order from the pharmacy`
          : "Rider is picking up your order soon",
        time: null,
        isCompleted: false
      },
      onTheWay: {
        title: "On the Way",
        description: order.status === "Shipped"
          ? `Rider is on the way to your location. Estimated arrival: ${order.pharmacyId?.deliveryTime || '30-45 mins'}`
          : "Waiting for dispatch",
        time: null,
        isCompleted: false
      }
    };

    order.statusHistory.forEach(historyItem => {
      const formattedTime = new Date(historyItem.changedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      if (historyItem.status === "New") {
        timeline.orderConfirmed.isCompleted = true;
        timeline.orderConfirmed.time = formattedTime;
      }
      if (historyItem.status === "Preparing" || historyItem.status === "Ready") {
        timeline.pharmacyPreparing.isCompleted = true;
        timeline.pharmacyPreparing.time = formattedTime;
      }
      if (historyItem.status === "Shipped") {
        timeline.riderPickedUp.isCompleted = true;
        timeline.riderPickedUp.time = formattedTime;
        timeline.onTheWay.isCompleted = true;
        timeline.onTheWay.time = formattedTime;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        orderStatus: order.status, 

        riderInfo: order.deliveryManId ? {
          name: order.deliveryManId.name,
          vehicle: order.deliveryManId.vehicle,
          rating: order.deliveryManId.rating || 5.0,
          totalDeliveries: order.deliveryManId.totalDeliveries || 0,
          phones: order.deliveryManId.phones
        } : null, 

        statusTimeline: timeline,

        orderContents: {
          items: order.items.map(item => ({
            medicineId: item.medicineId?._id || item.medicineId,
            medicineName: item.medicineId?.medicineName || "Medicine",
            quantity: item.quantity,
            price: item.price,
            itemTotal: item.price * item.quantity
          })),
          summary: {
            subtotal: order.subtotal,
            deliveryFee: order.deliveryFee,
            discount: order.discount || 0,
            totalPrice: order.totalPrice,
            paymentMethod: order.paymentMethod
          }
        }
      }
    });

  } catch (err) {
    console.error("Error in getPatientOrderTracking:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};


exports.confirmOrderReceipt = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.status === "Completed") {
      return res.status(400).json({ success: false, message: "Order is already marked as Completed." });
    }

    order.status = "Completed";
    order.patientConfirmedCompletion = true;
    order.patientConfirmedAt = new Date();
    order.completedAt = new Date();

    if (order.paymentMethod === "Cash") {
      order.paymentStatus = "Paid";
    }

    order.statusHistory.push({
      status: "Completed",
      note: "Order receipt confirmed by the patient. All medications verified as Received."
    });

    await order.save();

    const COMMISSION_RATE = 0.01;
    const commissionAmount = parseFloat((order.totalPrice * COMMISSION_RATE).toFixed(2));
    const pharmacyEarning = parseFloat((order.totalPrice - commissionAmount).toFixed(2));

    order.commissionRate = COMMISSION_RATE * 100;
    order.commissionAmount = commissionAmount;
    order.pharmacyEarning = pharmacyEarning;
    await order.save();

    let transaction = null;
    try {
      console.log("DEBUG → order.pharmacyId:", order.pharmacyId);

      const pharmacy = await Pharmacy.findById(order.pharmacyId).select("userId");

      console.log("DEBUG → pharmacy found:", pharmacy);

      if (!pharmacy) {
        console.error("Pharmacy not found for transaction creation. pharmacyId was:", order.pharmacyId);
      } else if (!pharmacy.userId) {
        console.error("Pharmacy found but has no userId:", pharmacy);
      } else {
        transaction = await Transaction.create({
          payer: order.userId,
          recipient: pharmacy.userId,
          amount: order.totalPrice,
          currency: "EGP",
          type: "pharmacy_order",
          status: order.paymentMethod === "Cash" ? "completed" : "pending",
          paymentMethod: order.paymentMethod === "Cash" ? "cash" : "online",
          platformFeeRate: COMMISSION_RATE,
          platformFeeAmount: commissionAmount,
          platformFeePaid: false,
          relatedModel: "Order",
          relatedId: order._id,
          note: `Pharmacy order #${order.orderNumber} — pharmacy earns EGP ${pharmacyEarning}`,
        });

        console.log("DEBUG → transaction created:", transaction._id);
      }
    } catch (txErr) {
      console.error("Transaction creation failed (full error):", txErr);
    }

    if (order.deliveryManId) {
      await mongoose.model("DeliveryMan").findByIdAndUpdate(order.deliveryManId, {
        $inc: { totalDeliveries: 1 },
        $set: { status: "Available" },
      });
    }

    await Notification.create({
      recipient: order.userId,
      title: "Order Completed",
      message: `Your order #${order.orderNumber} has been confirmed as received successfully!`,
      type: "order_status"
    });

    return res.status(200).json({
      success: true,
      message: "Order receipt confirmed successfully!",
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalPrice: order.totalPrice,
        commission: commissionAmount,
        pharmacyEarns: pharmacyEarning,
        transactionId: transaction ? transaction._id : null,
        verifiedItems: order.items.map(item => ({
          medicineId: item.medicineId,
          quantity: item.quantity,
          price: item.price,
          itemStatus: "Received",
        })),
      },
    });

  } catch (err) {
    console.error("Error in confirmOrderReceipt:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};




exports.patientSearch = async (req, res) => {
  try {
    const { search, type, homeService, openNow, lat, lng, requiredServices } = req.query;

    let labQuery = {};

    if (type) {
      if (type === 'scan') labQuery.facilityType = { $in: ['radiology center', 'both'] };
      else if (type === 'lab') labQuery.facilityType = { $in: ['lab', 'both'] };
    }

    if (homeService === 'true') {
      labQuery.homeSampleCollection = true;
    }

    if (openNow === 'true') {
      const currentHour = new Date().getHours();
      labQuery["workingHours.open"] = { $lte: currentHour };
      labQuery["workingHours.close"] = { $gt: currentHour };
    }

    if (requiredServices) {
      const servicesArray = requiredServices.split(',').map(s => s.trim());

      const regexPatterns = servicesArray.map(service => new RegExp(service, 'i'));

      const matchedServices = await Service.find({
        name: { $in: regexPatterns },
        isActive: true
      }).select('labId');

      const labIds = matchedServices.map(s => s.labId);
      labQuery._id = { $in: labIds };
    }

    if (search && !requiredServices) {
      const matchedUsers = await User.find({
        name: { $regex: search, $options: 'i' },
        role: 'lab'
      }).select('_id');

      const matchedServices = await Service.find({
        name: { $regex: search, $options: 'i' },
        isActive: true
      }).select('labId');

      labQuery.$or = [
        { userId: { $in: matchedUsers.map(u => u._id) } },
        { _id: { $in: matchedServices.map(s => s.labId) } }
      ];
    }

    let labs = [];
    if (lat && lng) {
      labs = await Lab.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
            distanceField: "distanceResult",
            spherical: true,
            query: labQuery
          }
        },
        { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "userId" } },
        { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } }
      ]);
    } else {
      labs = await Lab.find(labQuery).populate('userId', 'name email phoneNumber').lean();
    }

    let formattedCenters = await Promise.all(labs.map(async (lab) => {
      const services = await Service.find({ labId: lab._id, isActive: true });
      const minPrice = services.length > 0 ? Math.min(...services.map(s => s.price)) : 0;
      const distanceNum = lab.distanceResult !== undefined ? lab.distanceResult / 1000 : null;

      return {
        labId: lab._id,
        name: lab.userId ? lab.userId.name : "Unknown Center",
        facilityType: lab.facilityType,
        rating: lab.rating || 4.5,
        distanceNum: distanceNum,
        distance: distanceNum ? `${distanceNum.toFixed(1)} km` : "Unknown",
        homeServiceAvailable: lab.homeSampleCollection || false,
        insuranceAccepted: lab.insuranceAccepted || false,
        minPrice: minPrice,
        badge: null, 
        nextSlot: "Today 10:30 AM",
        availableTags: services.map(s => ({ name: s.name, category: s.category, isPartner: false }))
      };
    }));

    if (formattedCenters.length > 0) {
      const validDistances = formattedCenters.filter(c => c.distanceNum !== null);
      if (validDistances.length > 0) {
        const nearest = validDistances.reduce((min, c) => c.distanceNum < min.distanceNum ? c : min, validDistances[0]);
        nearest.badge = "Nearest";
      }

      const validPrices = formattedCenters.filter(c => c.minPrice > 0 && c.badge === null);
      if (validPrices.length > 0) {
        const cheapest = validPrices.reduce((min, c) => c.minPrice < min.minPrice ? c : min, validPrices[0]);
        cheapest.badge = "Cheapest";
      }

      const topRated = formattedCenters.reduce((max, c) => (c.rating > max.rating && c.badge === null) ? c : max, formattedCenters[0]);
      if (topRated && topRated.badge === null && topRated.rating >= 4.7) {
        topRated.badge = "Top Rated";
      }
    }

    res.status(200).json({
      success: true,
      count: formattedCenters.length,
      isAIRanked: true,
      centers: formattedCenters
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.getPatientLabResults = async (req, res) => {
  try {
    const patient = await Patient.findOne({ userId: req.user._id });
    if (!patient) {
      return res.status(404).json({ success: false, message: "Patient profile not found" });
    }

    const completedResults = await LabRequest.find({
      patientId: patient._id,
      status: "completed"
    })
      .populate({
        path: 'labId',
        model: 'Lab',
        populate: {
          path: 'userId',
          model: 'User',
          select: 'name'
        }
      })
      .populate('services', 'name')
      .sort({ resultUploadedAt: -1 })
      .lean();

    const formattedResults = completedResults.map(reqItem => {
      const fileName = reqItem.services && reqItem.services.length > 0
        ? reqItem.services.map(s => s.name).join(', ')
        : "Medical Analysis Report";

      return {
        requestId: reqItem._id,
        fileName: fileName,
        labName: reqItem.labId?.userId?.name || "The Medical Center",
        uploadedAt: reqItem.resultUploadedAt || reqItem.updatedAt,
        fileUrl: reqItem.resultFile || "",
        fileType: reqItem.resultFileType || "image",
        doctorNotes: "No specific notes provided by the specialist."
      };
    });

    res.status(200).json({
      success: true,
      count: formattedResults.length,
      results: formattedResults
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};