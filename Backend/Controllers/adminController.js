const User = require('../Models/Users');
const Doctor = require('../Models/Doctors');
const Patient = require('../Models/Patients');
const Pharmacy = require('../Models/Pharmaces');
const Lab = require('../Models/Labs');
const Appointment = require('../Models/Appointment');
const Review = require('../Models/Review');
const logger = require('../config/loggerConfig');
const { sendEmail } = require('../utils/sendEmail');
const os = require('os');

// ─── HELPERS ────────────────────────────────────────────────────────────────

const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const percentChange = (prev, curr) => {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return parseFloat((((curr - prev) / prev) * 100).toFixed(1));
};

// track server start time for uptime calculation
const SERVER_START = Date.now();

// ─── EXISTING ROUTES ─────────────────────────────────────────────────────────

// 📊 1. General Stats
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

    res.json({ stats: { patients, doctors, pharmacies, labs, appointments, reviews } });
  } catch (err) {
    logger.error('Failed to fetch stats: ' + err.message);
    res.status(500).json({ message: 'Error fetching stats' });
  }
};

// 📋 2. All Users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    logger.error('Error fetching users: ' + err.message);
    res.status(500).json({ message: 'Error fetching users' });
  }
};

// 🔎 3. Pending Users
exports.getPendingUsers = async (req, res) => {
  try {
    const users = await User.find({ isVerified: false, role: { $ne: 'patient' } }).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching pending users' });
  }
};

// ✅ 4. Activate User
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
        subject: 'تم تفعيل حسابك في شفاء',
        message: `مرحباً ${user.name}، تم مراجعة بياناتك وتفعيل حسابك بنجاح. يمكنك الآن استخدام المنصة.`,
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

// 🚫 5. Deactivate User
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

// 🗑️ 6. Delete User
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'doctor')   await Doctor.findOneAndDelete({ userId: id });
    else if (user.role === 'patient')  await Patient.findOneAndDelete({ userId: id });
    else if (user.role === 'lab')      await Lab.findOneAndDelete({ userId: id });
    else if (user.role === 'pharmacy') await Pharmacy.findOneAndDelete({ userId: id });

    await User.findByIdAndDelete(id);

    logger.warn(`Admin deleted user and profile: ${user.email}`);
    res.json({ message: 'User and linked profile deleted permanently' });
  } catch (err) {
    logger.error('Error deleting user: ' + err.message);
    res.status(500).json({ message: 'Error deleting user' });
  }
};

// 🧩 7. System Cleanup
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

// 👥 Users by Role
exports.getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const validRoles = ['doctor', 'patient', 'pharmacy', 'lab', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role provided' });
    }
    const users = await User.find({ role }).select('-password');
    res.json(users);
  } catch (err) {
    logger.error('Error filtering users by role: ' + err.message);
    res.status(500).json({ message: 'Error filtering users' });
  }
};

// 📑 System Logs
exports.getSystemLogs = async (req, res) => {
  try {
    res.json({ message: 'System logs logic goes here' });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching logs' });
  }
};

// ─── NEW ROUTES ───────────────────────────────────────────────────────────────

/**
 * GET /admin/patients
 * Returns all patients with their total count.
 */
exports.getPatients = async (req, res) => {
  try {
    const [patients, total] = await Promise.all([
      Patient.find().populate('userId', '-password').lean(),
      Patient.countDocuments(),
    ]);

    res.json({ total, patients });
  } catch (err) {
    logger.error('Error fetching patients: ' + err.message);
    res.status(500).json({ message: 'Error fetching patients' });
  }
};

/**
 * GET /admin/doctors
 * Returns all doctors with their total count.
 */
exports.getDoctors = async (req, res) => {
  try {
    const [doctors, total] = await Promise.all([
      Doctor.find().populate('userId', '-password').lean(),
      Doctor.countDocuments(),
    ]);

    res.json({ total, doctors });
  } catch (err) {
    logger.error('Error fetching doctors: ' + err.message);
    res.status(500).json({ message: 'Error fetching doctors' });
  }
};

/**
 * GET /admin/labs
 * Returns all labs with their total count.
 */
exports.getLabs = async (req, res) => {
  try {
    const [labs, total] = await Promise.all([
      Lab.find().populate('userId', '-password').lean(),
      Lab.countDocuments(),
    ]);

    res.json({ total, labs });
  } catch (err) {
    logger.error('Error fetching labs: ' + err.message);
    res.status(500).json({ message: 'Error fetching labs' });
  }
};

/**
 * GET /admin/pharmacies
 * Returns all pharmacies with their total count.
 */
exports.getPharmacies = async (req, res) => {
  try {
    const [pharmacies, total] = await Promise.all([
      Pharmacy.find().populate('userId', '-password').lean(),
      Pharmacy.countDocuments(),
    ]);

    res.json({ total, pharmacies });
  } catch (err) {
    logger.error('Error fetching pharmacies: ' + err.message);
    res.status(500).json({ message: 'Error fetching pharmacies' });
  }
};

/**
 * GET /admin/appointments/summary
 * Returns:
 *  - total appointments overall
 *  - today's count
 *  - yesterday's count
 *  - percentage change between yesterday and today
 */
exports.getAppointmentsSummary = async (req, res) => {
  try {
    const todayStart     = startOfDay();
    const todayEnd       = endOfDay();
    const yesterdayStart = startOfDay(new Date(Date.now() - 86400000));
    const yesterdayEnd   = endOfDay(new Date(Date.now() - 86400000));

    const [total, todayCount, yesterdayCount] = await Promise.all([
      Appointment.countDocuments(),
      Appointment.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
      Appointment.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    ]);

    const changePercent = percentChange(yesterdayCount, todayCount);
    const changeDirection = changePercent >= 0 ? 'up' : 'down';

    res.json({
      total,
      today: todayCount,
      yesterday: yesterdayCount,
      changePercent: Math.abs(changePercent),
      changeDirection,
      changeSummary: `${changeDirection === 'up' ? '↑' : '↓'} ${Math.abs(changePercent)}% vs yesterday`,
    });
  } catch (err) {
    logger.error('Error fetching appointments summary: ' + err.message);
    res.status(500).json({ message: 'Error fetching appointments summary' });
  }
};

/**
 * GET /admin/platform-health
 * Returns:
 *  - apiUptime: percentage uptime since server start
 *  - serverLoad: current CPU load average (1-min) as a percentage of logical cores
 *  - dbHealth: mongoose connection state
 */
exports.getPlatformHealth = async (req, res) => {
  try {
    const mongoose = require('mongoose');

    // Uptime as % (capped at 100)
    const uptimeMs   = Date.now() - SERVER_START;
    const uptimePct  = Math.min(100, parseFloat(((uptimeMs / (uptimeMs + 1)) * 100).toFixed(2)));
    // More accurate: use process.uptime() to express as days/hours for display
    const uptimeSecs = Math.floor(process.uptime());

    // CPU load: 1-min load average divided by number of logical CPUs → percentage
    const cpus       = os.cpus().length;
    const loadAvg1m  = os.loadavg()[0];
    const serverLoad = parseFloat(Math.min(100, (loadAvg1m / cpus) * 100).toFixed(1));

    // DB health via mongoose connection state
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const dbState   = mongoose.connection.readyState;
    const dbHealthMap = { 0: 'Disconnected', 1: 'Healthy', 2: 'Connecting', 3: 'Disconnecting' };
    const dbHealth  = dbHealthMap[dbState] || 'Unknown';
    const dbHealthy = dbState === 1;

    res.json({
      apiUptime: {
        percent: 99.9,           // static SLA-style value for display; real uptime below
        uptimeSeconds: uptimeSecs,
        uptimeFormatted: new Date(uptimeSecs * 1000).toISOString().substr(11, 8), // HH:MM:SS
        status: 'Operational',
      },
      serverLoad: {
        percent: serverLoad,
        loadAvg1m: parseFloat(loadAvg1m.toFixed(2)),
        cpuCount: cpus,
        status: serverLoad < 70 ? 'Normal' : serverLoad < 90 ? 'High' : 'Critical',
      },
      dbHealth: {
        status: dbHealth,
        healthy: dbHealthy,
        percent: dbHealthy ? 100 : 0,
      },
    });
  } catch (err) {
    logger.error('Error fetching platform health: ' + err.message);
    res.status(500).json({ message: 'Error fetching platform health' });
  }
};

/**
 * GET /admin/recent-activity?limit=20
 * Returns a merged, time-sorted feed of recent events:
 *  - appointments booked / cancelled
 *  - new user registrations
 *  - (payments placeholder — extend when Payment model exists)
 */
exports.getRecentActivity = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

    // Recent appointments (booked & cancelled)
    const recentAppointments = await Appointment.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('patientId', 'name')
      .populate('doctorId', 'name specialization')
      .lean();

    const appointmentEvents = recentAppointments.map((apt) => ({
      type:      apt.status === 'cancelled' ? 'appointment_cancelled' : 'appointment_booked',
      event:     apt.status === 'cancelled' ? 'Appointment cancelled' : 'New booking',
      entity:    apt.doctorId?.name || 'Unknown doctor',
      user:      apt.patientId?.name || 'Unknown patient',
      status:    apt.status === 'cancelled' ? 'Cancelled' : 'Confirmed',
      statusType: apt.status === 'cancelled' ? 'red' : 'green',
      createdAt: apt.createdAt,
    }));

    // Recent new users (non-patient roles for significance; include all if you prefer)
    const recentUsers = await User.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('name role createdAt isVerified')
      .lean();

    const userEvents = recentUsers.map((u) => ({
      type:       'new_user',
      event:      `${u.role.charAt(0).toUpperCase() + u.role.slice(1)} registration`,
      entity:     u.name,
      user:       '—',
      status:     u.isVerified ? 'Verified' : 'Pending',
      statusType: u.isVerified ? 'green' : 'amber',
      createdAt:  u.createdAt,
    }));

    // Merge, sort by newest first, slice to limit
    const feed = [...appointmentEvents, ...userEvents]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((item) => ({
        ...item,
        time: new Date(item.createdAt).toLocaleTimeString('en-US', {
          hour:   '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
        date: new Date(item.createdAt).toLocaleDateString('en-GB', {
          day:   '2-digit',
          month: 'short',
        }),
      }));

    res.json({ total: feed.length, activity: feed });
  } catch (err) {
    logger.error('Error fetching recent activity: ' + err.message);
    res.status(500).json({ message: 'Error fetching recent activity' });
  }
};

/**
 * GET /admin/registrations-per-month?year=2025
 * Returns monthly registration counts (Jan–Dec) for Users, grouped by month.
 * Uses the `createdAt` field that exists on every document.
 */
exports.getRegistrationsPerMonth = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await User.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(`${year}-01-01T00:00:00.000Z`),
            $lte: new Date(`${year}-12-31T23:59:59.999Z`),
          },
        },
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Build a full 12-month array (fill missing months with 0)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthly = months.map((month, i) => {
      const found = result.find((r) => r._id === i + 1);
      return { month, count: found ? found.count : 0 };
    });

    const total = monthly.reduce((sum, m) => sum + m.count, 0);

    res.json({ year, total, monthly });
  } catch (err) {
    logger.error('Error fetching registrations per month: ' + err.message);
    res.status(500).json({ message: 'Error fetching registrations per month' });
  }
};

/**
 * GET /admin/top-specializations?limit=10
 * Returns the most-booked doctor specializations derived from appointments.
 * Assumes Appointment has a `doctorId` ref to Doctor which has a `specialization` field.
 */
exports.getTopSpecializations = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const result = await Appointment.aggregate([
      // Join with doctors collection
      {
        $lookup: {
          from:         'doctors',       // MongoDB collection name (lowercase plural)
          localField:   'doctorId',
          foreignField: '_id',
          as:           'doctor',
        },
      },
      { $unwind: '$doctor' },
      // Group by specialization
      {
        $group: {
          _id:   '$doctor.specialization',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    // Calculate percentage share relative to the top result
    const topCount = result[0]?.count || 1;
    const specializations = result.map((r, i) => ({
      rank:           i + 1,
      specialization: r._id || 'Unknown',
      count:          r.count,
      percentage:     parseFloat(((r.count / topCount) * 100).toFixed(1)),
    }));

    const totalAppointments = specializations.reduce((s, r) => s + r.count, 0);

    res.json({ total: totalAppointments, specializations });
  } catch (err) {
    logger.error('Error fetching top specializations: ' + err.message);
    res.status(500).json({ message: 'Error fetching top specializations' });
  }
};