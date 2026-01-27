const express = require('express');
const router = express.Router();

// استيراد الـ Controller
const patientController = require('../Controllers/patientController');

// استيراد الـ Middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');
const { upload } = require('../middleware/upload');

// عرض البروفايل
router.get('/profile', auth, authorizeRoles('patient'), patientController.getProfile);

// تعديل البروفايل
router.put('/profile', auth, authorizeRoles('patient'), runValidation, patientController.updateProfile);

// عرض المواعيد
router.get('/appointments', auth, authorizeRoles('patient'), patientController.getAppointments);

// رفع ملفات (أشعة/تحاليل) - نستخدم upload.single
router.post('/upload-scan', auth, authorizeRoles('patient'), upload.single("scan"), patientController.uploadAttachment);

// التاريخ المرضي
router.get('/medical-history', auth, authorizeRoles('patient'), patientController.getMedicalHistory);

module.exports = router;