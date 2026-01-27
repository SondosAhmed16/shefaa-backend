const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const { sendSMS } = require('./smsService');
const sendMail = require('../config/mailer');

cron.schedule('*/30 * * * *', async () => {
  try {
    const now = new Date();
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

    const upcomingAppointments = await Appointment.find({
      date: { $gte: now, $lte: nextHour },
    }).populate('patient doctor');

    for (const appt of upcomingAppointments) {
      const message = `Reminder: Your appointment with Dr.${appt.doctor.name} is at ${appt.date.toLocaleTimeString()}`;
      if (appt.patient.phone) await sendSMS(appt.patient.phone, message);
      if (appt.patient.email) await sendMail(appt.patient.email, 'Appointment Reminder', message);
    }

    console.log(`✅ Appointment reminders sent at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('Scheduler error:', err.message);
    // إيقاف الـ cron في حالة خطأ متكرر
    if (err.code === 'ECONNREFUSED') cron.destroy();
  }
});