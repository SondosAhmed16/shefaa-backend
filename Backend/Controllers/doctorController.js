const Doctor = require('../Models/Doctors');
const Clinic = require('../Models/Clinic');
const Appointment = require('../Models/Appointment');
const MedicalRecord = require('../Models/MedicalRecord');
const User = require('../Models/Users');

exports.getDoctorProfile = async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user._id })
      .populate('userId', 'name email phone')   // User fields
      .populate('clinics')                        // full Clinic docs
      .populate('reviews');                       // optional

    if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });

    // Flatten بشكل واضح للـ frontend
    const profile = {
      // من Doctor model
      _id: doctor._id,
      specialization: doctor.specialization,
      age: doctor.age,
      yearsOfExperience: doctor.yearsOfExperience,
      image: doctor.image,
      about: doctor.about,
      degrees: doctor.degrees,
      gender: doctor.gender,
      rating: doctor.rating,
      paymentOption: doctor.paymentOption,
      prePaymentNumbers: doctor.prePaymentNumbers,
      clinicConsultationPrice: doctor.clinicConsultationPrice,
      clinics: doctor.clinics,
      reviews: doctor.reviews,
      contactNumber:doctor.contactNumber,
      membershipPdf:doctor.membershipPdf,
      name: doctor.userId?.name,
      email: doctor.userId?.email,
      phone: doctor.userId?.phone,
    };

    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



exports.updateDoctorProfile = async (req, res) => {
  try {
    const {
      specialization,
      yearsOfExperience,
      about,
      age,
      paymentOption,
      gender,
      contactNumber,
      degrees,
      prePaymentNumbers,
      clinicConsultationPrice,
      name, // from User model
    } = req.body;

    // Handle image upload if a file was sent (assumes multer middleware)
    const image = req.file ? req.file.path : undefined;

    // --- Update Doctor document ---
    const doctorUpdateData = {
      specialization,
      yearsOfExperience,
      about,
      age,
      paymentOption,
      contactNumber,
      degrees,
      prePaymentNumbers,
      clinicConsultationPrice,
      ...(gender && { gender: gender.toLowerCase() }),
      ...(image && { image }),
    };

    // Remove undefined fields so they don't overwrite existing data
    Object.keys(doctorUpdateData).forEach(
      (key) => doctorUpdateData[key] === undefined && delete doctorUpdateData[key]
    );

    const doctor = await Doctor.findOneAndUpdate(
      { userId: req.user._id },
      doctorUpdateData,
      { new: true, runValidators: true }
    );

    if (!doctor) return res.status(404).json({ message: "Doctor profile not found" });

    // --- Update User document (name) ---
    if (name) {
      await User.findByIdAndUpdate(
        req.user._id,
        { name },
        { new: true, runValidators: true }
      );
    }

    res.json({ message: "Doctor profile updated successfully", doctor });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



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
      const clinicsInCity = await Clinic.find({
        city: { $regex: new RegExp(city, "i") }
      });

      const doctorIds = clinicsInCity.map(c => c.doctorId.toString());
      doctorQuery._id = { $in: doctorIds };
    }

    let userMatch = { path: "userId", select: "name" };

    if (name) {
      userMatch.match = {
        name: { $regex: new RegExp(name, "i") }
      };
    }

    let doctors = await Doctor.find(doctorQuery)
      .populate(userMatch)
      .lean();

    if (name) {
      doctors = doctors.filter(doc => doc.userId !== null);
    }

    const results = await Promise.all(
      doctors.map(async (doctor) => {
        const doctorClinics = await Clinic.find({
          doctorId: doctor._id,
          ...(city && {
            city: { $regex: new RegExp(city, "i") }
          })
        }).lean(); // رجّع الكلينك كامل

        return {
          _id: doctor._id,
          name: doctor.userId?.name || "Unknown",

          specialization: doctor.specialization,
          age: doctor.age,
          yearsOfExperience: doctor.yearsOfExperience,
          image: doctor.image,
          about: doctor.about,
          degrees: doctor.degrees,
          gender: doctor.gender,
          rating: doctor.rating,

          prePaymentNumbers: doctor.prePaymentNumbers,
          clinicConsultationPrice: doctor.clinicConsultationPrice,

          reviews: doctor.reviews || [],

          clinics: doctorClinics // هنا رجّعناه كامل بدون map
        };
      })
    );

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

// Get clinics by doctor id
exports.getDoctorClinics = async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Try finding doctor by Doctor model _id first, then fall back to userId
    let doctor = await Doctor.findById(doctorId).catch(() => null);

    if (!doctor) {
      doctor = await Doctor.findOne({ userId: doctorId });
    }

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    const clinics = await Clinic.find({ doctorId: doctor._id });

    res.status(200).json({
      doctorId: doctor._id,
      totalClinics: clinics.length,
      clinics
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
