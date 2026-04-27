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
// Controllers/doctorController.js

exports.updateDoctorProfile = async (req, res) => {
  try {
    const {
      specialization,
      yearsOfExperience,
      preOnlineConsultation,
      about,
      age,
      paymentOption,
      gender
    } = req.body;

    const doctor = await Doctor.findOneAndUpdate(
      { userId: req.user._id },
      {
        specialization,
        yearsOfExperience,
        preOnlineConsultation,
        about,
        age,
        paymentOption,
        gender: gender ? gender.toLowerCase() : undefined
      },
      { new: true, runValidators: true }
    );

    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });
    res.json({ message: 'Doctor profile updated successfully', doctor });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/*
// 3. Add a new Clinic
exports.addClinic = async (req, res) => {
  try {
    // التعديل هنا: لازم تضيفي capacityPerSlot جوه القوسين دول
    const { 
      name, city, address, location, availableDays, 
      dailyCapacity, slotDuration, capacityPerSlot, price 
    } = req.body;

    const doctor = await Doctor.findOne({ userId: req.user._id });
    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });

    const newClinic = await Clinic.create({
      doctorId: doctor._id,
      name,
      city,
      address,
      location,
      availableDays,
      dailyCapacity,
      slotDuration,
      capacityPerSlot, 
      price
    });

    doctor.clinics.push(newClinic._id);
    await doctor.save();

    res.status(201).json({ message: 'Clinic added successfully', clinic: newClinic });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};*/

/*

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
};*/

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

//search doctor {name , city , specialization , gender}
exports.searchDoctors = async (req, res) => {
  try {
    const { specialization, gender, city, name } = req.query;

    let doctorQuery = {};

    if (specialization) {
      doctorQuery.specialization = { $regex: new RegExp(specialization, "i") };
    }
    
    if (gender && gender.trim() !== "") {
      doctorQuery.gender = gender.toLowerCase();
    }

    if (city) {
      const clinicsInCity = await Clinic.find({ city: { $regex: new RegExp(city, "i") } });
      const doctorIds = clinicsInCity.map(c => c.doctorId.toString());
      doctorQuery._id = { $in: doctorIds };
    }

    let userMatch = { path: 'userId', select: 'name' }; 
    if (name) {
      userMatch.match = { name: { $regex: new RegExp(name, "i") } };
    }

    let doctors = await Doctor.find(doctorQuery).populate(userMatch);

    if (name) {
      doctors = doctors.filter(doc => doc.userId !== null);
    }

    const results = await Promise.all(doctors.map(async (doc) => {
      const doctorClinics = await Clinic.find({
        doctorId: doc._id,
        ...(city && { city: { $regex: new RegExp(city, "i") } })
      }, 'name city address location price availableDays'); 

      return {
        _id: doc._id,
        name: doc.userId ? doc.userId.name : "Unknown",
        specialization: doc.specialization,
        clinics: doctorClinics.map(clinic => ({
          name: clinic.name,
          city: clinic.city,
          address: clinic.address,
          location: clinic.location,
          price: clinic.price,
          daysOfWeek: clinic.availableDays.map(slot => ({
            day: slot.day,
            open: slot.from, 
            close: slot.to   
          }))
        }))
      };
    }));

    const finalResult = city
      ? results.filter(r => r.clinics.length > 0)
      : results;

    res.json(finalResult);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getDoctorDashboard = async (req, res) => {
  try {
    const doctorProfile = await Doctor.findOne({ userId: req.user._id });
    if (!doctorProfile) return res.status(404).json({ message: "Doctor profile not found" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await Appointment.find({ doctor: doctorProfile._id })
      .populate({
        path: 'patient',
        populate: { path: 'userId', select: 'name image' } 
      })
      .populate('clinic', 'name')
      .sort({ date: 1, slotStart: 1 }); 

   
    const todayApps = appointments.filter(a => new Date(a.date).getTime() === today.getTime());
    const stats = {
      totalToday: todayApps.length,
      completed: todayApps.filter(a => a.status === 'completed').length,
      pending: todayApps.filter(a => a.status === 'booked').length
    };

    res.json({
      stats,
      appointments // You can now filter this array on frontend for "Requests" vs "Upcoming"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};