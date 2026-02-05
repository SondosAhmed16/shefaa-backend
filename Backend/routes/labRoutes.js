const express = require('express');
const router = express.Router();
const labController = require('../Controllers/labController');
const { auth } = require('../middleware/auth'); 
const { runValidation } = require('../middleware/validate'); // استدعاء الـ Validation
const { body } = require('express-validator'); // عشان نحدد الشروط
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// إعداد التخزين
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'lab_results',
    resource_type: 'raw', 
    format: async (req, file) => 'pdf',
    public_id: (req, file) => 'result-' + Date.now(),
  },
});
const upload = multer({ storage: storage });

// --- الراوتس مع الـ Validation ---

// إضافة تحليل جديد (مع التأكد من البيانات)
router.post(
  '/add-test', 
  auth, 
  [
    body("testName").notEmpty().withMessage("Test name is required"),
    body("price").isNumeric().withMessage("Price must be a number")
  ],
  runValidation, // التأكد من صحة الشروط
  labController.addTest
);

// رفع نتيجة تحليل (هنا بنستخدم الـ Multer الأول)
router.post(
  '/upload-result', 
  auth, 
  upload.single('resultFile'), 
  [
    body("patientId").notEmpty().withMessage("Patient ID is required"),
    body("testName").notEmpty().withMessage("Test name is required")
  ],
  runValidation, 
  labController.uploadResult
);

// باقي الراوتس مش محتاجة Body Validation لأنها بتعتمد على الـ ID في الـ URL
router.get('/my-tests', auth, labController.getTests);
router.get('/patient-results/:patientId', auth, labController.getPatientResults);

module.exports = router;