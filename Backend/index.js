require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db.js");  

// Import Middlewares
const securityMiddleware = require("./middleware/security.js"); 
const errorHandler = require("./middleware/errorHandler.js");

// --- [تعديل هنا] Import Routes ---
const authRoutes = require("./routes/authRoutes.js");
const patientRoutes = require("./routes/patientRoute.js"); 
const doctorRoutes = require("./routes/doctorRoutes.js"); // إضافة راوت الدكتور
const pharmacyRoutes = require("./routes/pharmacyRoutes.js"); // إضافة راوت الصيدلية

const app = express();

// 1. Security Middlewares
securityMiddleware(app); 

// 2. Standard Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Static Folder
app.use("/uploads", express.static("uploads"));

// Connect to MongoDB
connectDB();

// Test Route
app.get("/", (req, res) => {
  res.send("Backend is alive and healthy!");
});

// --- [تعديل هنا] 4. Routes Mapping ---
app.use("/api/auth", authRoutes); 
app.use("/api/patient", patientRoutes); 
app.use("/api/doctor", doctorRoutes); // تفعيل مسار الدكتور
app.use("/api/pharmacy", pharmacyRoutes); // تفعيل مسار الصيدلية

// 5. Global Error Handler
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});