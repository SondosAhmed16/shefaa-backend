const Patient = require('../Models/Patients');
const Appointment = require('../Models/Appointment');
const MedicalRecord = require('../Models/MedicalRecord');
const Notification = require('../Models/Notification');
const User = require('../Models/Users');
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

    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { address, phoneNumber, age, gender, height, weight },
      { new: true, runValidators: true }
    );

    if (!patient) return res.status(404).json({ message: 'Patient profile not found' });

    res.json({
      message: 'Basic info updated successfully',
      updatedData: {
        name,
        address,
        phoneNumber,
        age,
        gender,
        height,
        weight
      }
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
};

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
