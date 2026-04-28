const express = require('express');
const router = express.Router();
const doctorController = require('../Controllers/doctorController');
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

// 1. Profile Routes
router.get('/profile', auth, authorizeRoles('doctor'), doctorController.getDoctorProfile);
router.put(
  '/profile',
  auth,
  authorizeRoles('doctor'),
  uploadImage.single('image'), // <-- handles the image field
  runValidation,
  doctorController.updateDoctorProfile
);

router.get('/search-doctors', doctorController.searchDoctors);

// 2. Appointments & Medical Records
router.get('/doctorDashboard', auth, authorizeRoles('doctor'), doctorController.getDoctorDashboard);
router.post('/add-medical-record', auth, authorizeRoles('doctor'), runValidation, doctorController.addMedicalRecord);

module.exports = router;