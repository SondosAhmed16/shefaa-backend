const User = require('../Models/Users');
const Doctor = require('../Models/Doctors');
const Patient = require('../Models/Patients');
const Pharmacy = require('../Models/Pharmaces'); 
const Lab = require('../Models/Labs');
const Appointment = require('../Models/Appointment');
const Review = require('../Models/Review');
const logger = require('../config/loggerConfig'); 
const { sendEmail } = require('../utils/sendEmail');

// 📊 1. الإحصائيات العامة (Stats)
exports.getStats = async (req, res) => {
  try {
    const [patients, doctors, pharmacies, labs, appointments, reviews] = await Promise.all([
      Patient.countDocuments(),
      Doctor.countDocuments(),
      Pharmacy.countDocuments(),
      Lab.countDocuments(),
      Appointment.countDocuments(),
      Review.countDocuments(),
    ]);

    res.json({
      stats: {
        patients,
        doctors,
        pharmacies,
        labs,
        appointments,
        reviews,
      },
    });
  } catch (err) {
    logger.error('Failed to fetch stats: ' + err.message);
    res.status(500).json({ message: 'Error fetching stats' });
  }
};

// 📋 2. عرض كل المستخدمين
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    logger.error('Error fetching users: ' + err.message);
    res.status(500).json({ message: 'Error fetching users' });
  }
};

// 🔎 3. عرض المستخدمين غير المفعلين (اللي مستنيين مراجعة الأدمن)
exports.getPendingUsers = async (req, res) => {
  try {
    const users = await User.find({ isVerified: false, role: { $ne: 'patient' } }).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching pending users' });
  }
};

// ✅ 4. تفعيل حساب (بعد مراجعة الأدمن للورق)
exports.activateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isVerified = true;
    await user.save();

    try {
      await sendEmail({
        email: user.email,
        subject: "تم تفعيل حسابك في شفاء",
        message: `مرحباً ${user.name}، تم مراجعة بياناتك وتفعيل حسابك بنجاح. يمكنك الآن استخدام المنصة.`
      });
    } catch (mailErr) {
      logger.error('Email could not be sent: ' + mailErr.message);
    }

    logger.info(`Admin activated user: ${user.email}`);
    res.json({ message: 'Account activated and notification email sent.' });
  } catch (err) {
    logger.error('Error activating user: ' + err.message);
    res.status(500).json({ message: 'Error activating user' });
  }
};

// 🚫 5. إيقاف حساب مؤقتاً (Deactivate)
exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isVerified = false;
    await user.save();
    
    logger.info(`Admin deactivated user: ${user.email}`);
    res.json({ message: 'User deactivated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deactivating user' });
  }
};

// 🗑️ 6. حذف مستخدم نهائياً
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });


    if (user.role === 'doctor') await Doctor.findOneAndDelete({ userId: id });
    else if (user.role === 'patient') await Patient.findOneAndDelete({ userId: id });
    else if (user.role === 'lab') await Lab.findOneAndDelete({ userId: id });
    else if (user.role === 'pharmacy') await Pharmacy.findOneAndDelete({ userId: id });

    await User.findByIdAndDelete(id);

    logger.warn(`Admin deleted user and profile: ${user.email}`);
    res.json({ message: 'User and linked profile deleted permanently' });
  } catch (err) {
    logger.error('Error deleting user: ' + err.message);
    res.status(500).json({ message: 'Error deleting user' });
  }
};

// 🧩 7. تنظيف النظام (Cleanup)
exports.cleanup = async (req, res) => {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    await Promise.all([
      Appointment.deleteMany({ date: { $lt: ninetyDaysAgo } }), 
      Review.deleteMany({ rating: { $exists: false } }),
    ]);

    logger.info('System cleanup completed by admin');
    res.json({ message: 'Cleanup completed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error during cleanup' });
  }
};

exports.getPendingUsers = async (req, res) => {
  try {

    const users = await User.find({ 
      isVerified: false, 
      role: { $ne: 'patient' } 
    }).select('-password');
    
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching pending users' });
  }
};

exports.getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    
    const validRoles = ["doctor", "patient", "pharmacy", "lab", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role provided" });
    }

    const users = await User.find({ role }).select('-password');
    res.json(users);
  } catch (err) {
    logger.error('Error filtering users by role: ' + err.message);
    res.status(500).json({ message: 'Error filtering users' });
  }
};
// 📑 8. عرض سجلات النظام (Logs)
exports.getSystemLogs = async (req, res) => {
  try {
    res.json({ message: "System logs logic goes here" });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching logs' });
  }
};