require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db.js");  
const bcrypt = require('bcryptjs');
const passport = require('passport');
require('./utils/cronJobs.js');
require('./utils/billingCron.js')
require('./config/passport.js');
// Import Middlewares
const securityMiddleware = require("./middleware/security.js"); 
const errorHandler = require("./middleware/errorHandler.js");

// --- [تعديل هنا] Import Routes ---
const User = require('./Models/Users.js');
const authRoutes = require("./routes/authRoutes.js");
const patientRoutes = require("./routes/patientRoute.js"); 
const doctorRoutes = require("./routes/doctorRoutes.js"); 
const pharmacyRoutes = require("./routes/pharmacyRoutes.js"); 
const labRoutes = require("./routes/labRoutes.js");
const clinicRoutes = require("./routes/clinicRoutes.js");
const appointmentRoutes = require('./routes/appointmentRoutes.js');
const reviewRoutes = require('./routes/reviewRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
const LabReportRoutes = require('./routes/LabReportRoutes');
const chatboot = require('./routes/chatbootRoutes.js');
const app = express();
const cors = require('cors');

// This allows your local development environment
// Just keep this, remove the app.options line completely
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// 2. Standard Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Security Middlewares
securityMiddleware(app); 



app.use(passport.initialize());


// 3. Static Folder
app.use("/uploads", express.static("uploads"));

// Connect to MongoDB
connectDB();

// Test Route
app.get("/", (req, res) => {
  res.send("Backend is alive and healthy!");
});

// ---  4. Routes Mapping ---
app.use("/api/auth", authRoutes); 
app.use("/api/patient", patientRoutes); 
app.use("/api/doctor", doctorRoutes); 
app.use("/api/pharmacy", pharmacyRoutes); 
app.use("/api/lab", labRoutes);
app.use("/api/clinic", clinicRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/labReport', LabReportRoutes);
app.use('/api/chatboot', chatboot);

const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ email: 'admin@shefaa.com' });

    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123456', 10);
      
      await User.create({
        name: 'Super Admin',
        username: 'admin_shefaa',
        email: 'admin@shefaa.com',
        password: hashedPassword,
        phoneNumber: '01012345678', 
        role: 'admin',
        isVerified: true
      });
      
      console.log('✅ Admin account seeded!');
    } else {
      console.log('ℹ️  Admin account already exists.');
    }
  } catch (err) {
    console.log('❌ Admin seeding error:', err.message); 
  }
};
 
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

seedAdmin();