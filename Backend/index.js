require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db.js");  

// Import Middlewares
const securityMiddleware = require("./middleware/security.js"); // ملف الـ Security اللي فيه Helmet و CORS
const errorHandler = require("./middleware/errorHandler.js");

// Import Routes
const authRoutes = require("./routes/authRoutes.js");
const patientRoutes = require("./routes/patientRoute.js"); // إضافة راوت المريض

const app = express();

// 1. Security Middlewares (CORS, Helmet, etc.)
securityMiddleware(app); 

// 2. Standard Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Static Folder (عشان تقدر تفتح صور الأشعات والملفات المرفوعة)
app.use("/uploads", express.json(), express.static("uploads"));

// Connect to MongoDB
connectDB();

// Test Route
app.get("/", (req, res) => {
  res.send("Backend is alive!");
});

// 4. Routes
app.use("/api/auth", authRoutes); 
app.use("/api/patient", patientRoutes); // ربط راوت المريض

// 5. Global Error Handler (لازم يكون بعد الـ Routes)
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);