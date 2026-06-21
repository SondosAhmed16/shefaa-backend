const express = require('express');
const router = express.Router();
const doctorController = require('../Controllers/doctorController');
const aiDoctorController = require('../Controllers/AiDoctorController');
const DoctorBillingController=require("../Controllers/DoctorBillingController")
// في doctorRoutes.js — أضف الـ import ده
const aiContextController = require('../Controllers/DoctorContext');
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Importing your middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Storage for images (doctor profile pictures)
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shefaa_profile_images',
    resource_type: 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    public_id: (req, file) => 'doctor-' + req.user._id + '-' + Date.now(),
  },
});

const uploadImage = multer({ storage: imageStorage });

// ─── 1. Profile Routes ────────────────────────────────────────────────────────
router.get('/profile', auth, authorizeRoles('doctor'), doctorController.getDoctorProfile);
router.put(
  '/profile',
  auth,
  authorizeRoles('doctor'),
  uploadImage.single('image'),
  runValidation,
  doctorController.updateDoctorProfile
);

router.get('/search-doctors', doctorController.searchDoctors);

// ─── 2. Appointments & Medical Records ───────────────────────────────────────
router.get('/doctorDashboard', auth, authorizeRoles('doctor'), doctorController.getDoctorDashboard);
router.post('/add-medical-record', auth, authorizeRoles('doctor'), runValidation, doctorController.addMedicalRecord);

router.get('/:doctorId/clinics', auth, authorizeRoles('doctor', 'patient'), doctorController.getDoctorClinics);

// ─── 3. AI Assistant Routes ───────────────────────────────────────────────────

// POST /api/doctor/ai/chat
// Body: { message: string, history?: [{ role, content }] }
router.post('/ai/chat', auth, authorizeRoles('doctor'), aiDoctorController.aiChat);

// GET /api/doctor/ai/brief?lang=ar|en
router.get('/ai/brief', auth, authorizeRoles('doctor'), aiDoctorController.aiDailyBrief);

// GET /api/doctor/ai/financials?lang=ar|en
router.get('/ai/financials', auth, authorizeRoles('doctor'), aiDoctorController.aiFinancialAnalysis);


//billing
router.get("/summary", auth, authorizeRoles('doctor'),DoctorBillingController.getBillingSummary);
router.post("/pay", auth, authorizeRoles('doctor'),DoctorBillingController.payPlatformFee);
router.get("/history", auth, authorizeRoles('doctor'),DoctorBillingController.getBillingHistory);

module.exports = router;