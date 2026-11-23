require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const passport = require("passport");

const connectDB = require("./config/db.js");
require("./config/passport.js");

// Middlewares
const securityMiddleware = require("./middleware/security.js");
const errorHandler = require("./middleware/errorHandler.js");

// Models & Routes
const User = require("./Models/Users.js");
const authRoutes = require("./routes/authRoutes.js");
const patientRoutes = require("./routes/patientRoute.js");
const doctorRoutes = require("./routes/doctorRoutes.js");
const pharmacyRoutes = require("./routes/pharmacyRoutes.js");
const labRoutes = require("./routes/labRoutes.js");
const clinicRoutes = require("./routes/clinicRoutes.js");
const appointmentRoutes = require("./routes/appointmentRoutes.js");
const reviewRoutes = require("./routes/reviewRoutes.js");
const adminRoutes = require("./routes/adminRoutes.js");
const LabReportRoutes = require("./routes/LabReportRoutes");
const chatboot = require("./routes/chatbootRoutes.js");

const isVercel = !!process.env.VERCEL;

// الـ cron jobs مبتشتغلش على Vercel (serverless)، فبنشغلها محليًا بس
if (!isVercel) {
  require("./utils/cronJobs.js");
  require("./utils/billingCron.js");
}

const app = express();

// ---------- 1. CORS (لازم يكون أول حاجة) ----------
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://admindashboard-pi-lac.vercel.app",
];

const corsOptions = {
  origin: (origin, callback) => {
    // السماح لطلبات بدون origin (Postman, السيرفر نفسه)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // رفض بدون رمي error عشان ميكراشش الطلب
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

// cors() لوحده بيرد على طلبات الـ preflight (OPTIONS) لكل المسارات
// عشان كده مفيش app.options("*") (بيكراش في Express 5)
app.use(cors(corsOptions));

// ---------- 2. Body parsers ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- 3. Security ----------
securityMiddleware(app);

app.use(passport.initialize());

// ---------- 4. Static ----------
app.use("/uploads", express.static("uploads"));

// ---------- 5. Database ----------
connectDB();

// ---------- 6. Test route ----------
app.get("/", (req, res) => {
  res.send("Backend is alive and healthy!");
});

// ---------- 7. Routes ----------
app.use("/api/auth", authRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/doctor", doctorRoutes);
app.use("/api/pharmacy", pharmacyRoutes);
app.use("/api/lab", labRoutes);
app.use("/api/clinic", clinicRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/labReport", LabReportRoutes);
app.use("/api/chatboot", chatboot);

// ---------- 8. Error handler (لازم يكون بعد الـ routes) ----------
app.use(errorHandler);

// ---------- Seed admin ----------
const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ email: "admin@shefaa.com" });

    if (!adminExists) {
      const hashedPassword = await bcrypt.hash("admin123456", 10);

      await User.create({
        name: "Super Admin",
        username: "admin_shefaa",
        email: "admin@shefaa.com",
        password: hashedPassword,
        phoneNumber: "01012345678",
        role: "admin",
        isVerified: true,
      });

      console.log("✅ Admin account seeded!");
    } else {
      console.log("ℹ️  Admin account already exists.");
    }
  } catch (err) {
    console.log("❌ Admin seeding error:", err.message);
  }
};

seedAdmin();

// ---------- Start server (محليًا بس) ----------
const PORT = process.env.PORT || 5000;
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Vercel محتاج الـ app يتصدّر
module.exports = app;