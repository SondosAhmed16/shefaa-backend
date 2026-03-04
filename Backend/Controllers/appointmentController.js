const moment = require('moment');
const Appointment = require('../Models/Appointment');
const Clinic = require('../Models/Clinic');
const Doctor = require('../Models/Doctors');
const User = require('../Models/Users');
const Patient = require('../Models/Patients');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

exports.bookAppointment = async (req, res) => {
  try {
    const { clinicId, date, startTime, appointmentType, paymentOption } = req.body;


    const clinic = await Clinic.findById(clinicId);
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });


    const requestedDate = new Date(date);
    const dayName = requestedDate.toLocaleDateString('en-US', { weekday: 'long' });

    const workingDay = clinic.daysOfWeek.find(d => d.day === dayName);
    if (!workingDay) {
      return res.status(400).json({ message: `Clinic is closed on ${dayName}` });
    }


    const timeToMinutes = (timeStr) => {
      const [time, modifier] = timeStr.split(' ');
      let [hours, minutes] = time.split(':');
      if (hours === '12') hours = '00';
      if (modifier === 'PM') hours = parseInt(hours, 10) + 12;
      return parseInt(hours, 10) * 60 + parseInt(minutes, 10);
    };

    const requestedTime = timeToMinutes(startTime);
    const openTime = timeToMinutes(workingDay.open);
    const closeTime = timeToMinutes(workingDay.close);

    if (requestedTime < openTime || requestedTime >= closeTime) {
      return res.status(400).json({ 
        message: `Selected time is outside working hours (${workingDay.open} - ${workingDay.close})` 
      });
    }


    const appointmentCount = await Appointment.countDocuments({
      clinic: clinicId,
      date: requestedDate,
      slotStart: startTime,
      status: { $ne: 'cancelled' }
    });

    if (appointmentCount >= clinic.capacityPerSlot) {
      return res.status(400).json({ message: 'This time slot is already full.' });
    }


    const endTime = moment(startTime, 'hh:mm A')
                    .add(clinic.slotDuration, 'minutes')
                    .format('hh:mm A');

    const patientProfile = await Patient.findOne({ userId: req.user._id });
    if (!patientProfile) return res.status(404).json({ message: 'Patient profile not found' });

    const appointment = new Appointment({
      patient: patientProfile._id,
      doctor: clinic.doctorId,
      clinic: clinicId,
      date: requestedDate,
      slotStart: startTime,
      slotEnd: endTime,
      appointmentType,
      price: clinic.price, 
      paymentOption: paymentOption || 'atClinic',
      status: 'booked'
    });

    await appointment.save();
    res.status(201).json({ message: 'Appointment booked successfully', appointment });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAppointments = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'doctor') {
      const doctorProfile = await Doctor.findOne({ userId: req.user._id });
      if (!doctorProfile) return res.status(404).json({ message: "Doctor profile not found" });
      filter.doctor = doctorProfile._id;
    }
    else if (req.user.role === 'patient') {
      const patientProfile = await Patient.findOne({ userId: req.user._id });

      if (!patientProfile) {
        filter.patient = req.user._id;
      } else {

        filter.$or = [
          { patient: patientProfile._id },
          { patient: req.user._id }
        ];
      }
    }

    const appointments = await Appointment.find(filter)
      .populate({
        path: 'patient',
        select: 'userId',
        populate: { path: 'userId', select: 'name' }
      })
      .populate({
        path: 'doctor',
        select: 'userId',
        populate: { path: 'userId', select: 'name' }
      })
      .populate('clinic', 'name address city')
      .select('date slotStart slotEnd status price paymentOption')
      .sort({ createdAt: -1 });

    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.cancelAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findById(id);

    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const patientProfile = await Patient.findOne({ userId: req.user._id });

    if (!patientProfile || (appointment.patient.toString() !== patientProfile._id.toString() && req.user.role !== 'admin')) {
      return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
    }

    appointment.status = 'cancelled';
    await appointment.save();

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/*exports.confirmAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { paymentStatus: 'paid', status: 'confirmed' },
      { new: true }
    ).populate('clinic');

    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    res.json({ message: 'Appointment confirmed and paid', appointment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};*/


exports.sendReminders = async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await Appointment.find({
      date: {
        $gte: new Date().setHours(0, 0, 0, 0),
        $lte: tomorrow.setHours(23, 59, 59, 999)
      },
      status: 'booked'
    }).populate({
      path: 'patient',
      populate: { path: 'userId', select: 'email name' }
    });

    for (const app of appointments) {
      if (app.patient.userId.email) {
        await transporter.sendMail({
          to: app.patient.userId.email,
          subject: 'Appointment Reminder',
          text: `Hi ${app.patient.userId.name}, Reminder for your appointment today at ${app.slotStart}.`,
        });
      }
    }
  } catch (err) {
    console.error('Reminder Job Error:', err.message);
  }
};