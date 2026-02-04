const express = require('express');
const router = express.Router();
const multer = require('multer'); // لازم تسطبيها: npm install multer
const path = require('path');
const doctorController = require('../Controllers/doctorController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');

// --- إعدادات رفع الملفات (Multer Config) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/memberships/'); // تأكدي إن الفولدر ده موجود
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'membership-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('عفواً، مسموح فقط برفع ملفات PDF!'), false);
    }
  }
});

// --- الـ Route الجديد ---
router.post(
  '/upload-membership', 
  auth, 
  authorizeRoles('doctor'), 
  upload.single('membership'), // 'membership' هو اسم المفتاح في Postman
  doctorController.uploadMembership
);

// باقي الراوتس بتاعتك زي ما هي...
router.get('/profile', auth, authorizeRoles('doctor'), doctorController.getDoctorProfile);

module.exports = router;