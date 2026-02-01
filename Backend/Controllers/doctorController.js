const Doctor = require('../Models/Doctors');
const Clinic = require('../Models/Clinic');
const Appointment = require('../Models/Appointment');
const MedicalRecord = require('../Models/MedicalRecord');
const User = require('../Models/Users');

// 1. Get Doctor Profile with populated User and Clinic data
exports.getDoctorProfile = async (req, res) => {
  try {
    // Search using userId as defined in Doctors.js Schema
    const doctor = await Doctor.findOne({ userId: req.user._id })
      .populate('userId', 'name email') 
      .populate('clinics');
    
    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });
    res.json(doctor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. Update Doctor Profile information
exports.updateDoctorProfile = async (req, res) => {
  try {
    // Fields matching the Doctors.js Schema
    const { specialization, yearsOfExperience, preOnlineConsultation, about, age, paymentOption } = req.body;
    
    const doctor = await Doctor.findOneAndUpdate(
      { userId: req.user._id },
      { specialization, yearsOfExperience, preOnlineConsultation, about, age, paymentOption },
      { new: true, runValidators: true }
    );
    
    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });
    res.json({ message: 'Doctor profile updated successfully', doctor });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Add a new Clinic and link it to the Doctor
exports.addClinic = async (req, res) => {
  try {
    const { name, city, address, location, availableDays, daysOfWeek, dailyCapacity, slotDuration, price } = req.body;

    // Retrieve doctor profile to get the doctor's document ID
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });

    // Create the clinic record
const newClinic = await Clinic.create({
      doctorId: doctor._id,
      name,
      city,
      address,
      location,
      availableDays,
      dailyCapacity,
      slotDuration,
      capacityPerSlot, // وتأكدي إنها مبعوتة هنا 👇
      price
    });

    // Push the new Clinic ID into the doctor's clinics array
    doctor.clinics.push(newClinic._id);
    await doctor.save();

    res.status(201).json({ 
      message: 'Clinic added and linked to doctor successfully', 
      clinic: newClinic 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. Get all Appointments for the logged-in Doctor
exports.getAppointments = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });

    const appointments = await Appointment.find({ doctor: doctor._id })
      .populate('patient', 'name') // Fetch patient name
      .populate('clinic', 'name city') // Fetch clinic details
      .sort({ date: -1 }); // Order by newest
    
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 5. Create a new Medical Record for a patient
exports.addMedicalRecord = async (req, res) => {
  try {
    const { patientId, diagnosis, prescription, notes, nextVisitDate } = req.body;
    
    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });

    const record = await MedicalRecord.create({
      patientId,
      doctorId: doctor._id,
      diagnosis,
      prescription: prescription || [],
      notes,
      nextVisitDate,
      visitDate: new Date()
    });

    res.status(201).json({ message: 'Medical record added successfully', record });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};