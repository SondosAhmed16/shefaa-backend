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
    const { clinicId, date, startTime, endTime, paymentOption, price, isFollowUp } = req.body;

    const clinic = await Clinic.findById(clinicId);
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });


    const appointmentCount = await Appointment.countDocuments({
      clinic: clinicId,
      date: new Date(date),
      slotStart: startTime,
      status: { $ne: 'cancelled' }
    });

    if (appointmentCount >= clinic.capacityPerSlot) {
      return res.status(400).json({ 
        message: 'This time slot is full. Please choose another time.' 
      });
    }

    const appointment = new Appointment({
      patient: req.user._id, 
      doctor: clinic.doctorId,
      clinic: clinicId,
      date: new Date(date),
      slotStart: startTime,
      slotEnd: endTime,
      isFollowUp: isFollowUp || false,
      paymentOption: paymentOption || 'atClinic',
      price: price || 0,
      status: 'booked',
      paymentStatus: 'pending'
    });

    await appointment.save();

    try {
      await transporter.sendMail({
        to: req.user.email,
        subject: 'Appointment Booked Successfully',
        text: `Your appointment at ${clinic.name} on ${date} at ${startTime} has been booked.`,
      });
    } catch (mailErr) {
      console.error("Mail Error: Confirmation email couldn't be sent.");
    }

    res.status(201).json({ message: 'Appointment booked successfully', appointment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAppointments = async (req, res) => {
  try {
    let filter = {};
    
    if (req.user.role === 'doctor') {
      filter.doctor = req.user._id;
    } else {
      filter.patient = req.user._id;
    }

    const appointments = await Appointment.find(filter)
      .populate({
          path: 'doctor',
          select: 'userId', 
          populate: { path: 'userId', select: 'name' }
      })
      .populate({
          path: 'patient',
          select: 'userId phoneNumber',
          populate: { path: 'userId', select: 'name' }
      })
      .populate('clinic', 'name address city')
      .sort({ date: -1 });

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


    if (appointment.patient.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
    }

    appointment.status = 'cancelled';
    await appointment.save();

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.confirmAppointment = async (req, res) => {
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
};


exports.sendReminders = async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await Appointment.find({
      date: { 
        $gte: new Date().setHours(0,0,0,0), 
        $lte: tomorrow.setHours(23,59,59,999) 
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