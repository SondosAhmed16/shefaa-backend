const express = require('express');
const router = express.Router();
const notificationController = require('../Controllers/notificationController');
const { check } = require('express-validator'); // 🟢 ضيفي السطر ده فوراً هنا!
const labController = require('../Controllers/labController');
const { auth } = require('../middleware/auth'); 
const { runValidation } = require('../middleware/validate'); 
const { body } = require('express-validator'); 
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// إعداد التخزين
// التعديل المظبوط جوه ملفك مباشرة بدون أي require خارجي

// كود الـ cloudinary: cloudinary بيكون موجود عندك فوق في الملف أصلاً

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // 🟢 1. لو الملف اللي جاي عبارة عن صورة (أشعة توضيحية للـ Service)
    if (file.mimetype.startsWith('image/')) {
      const fileExtension = file.mimetype.split('/')[1]; // png, jpeg, jpg
      return {
        folder: 'lab_services_images', // فولدر صور الخدمات
        resource_type: 'image',
        format: fileExtension,
        public_id: 'service-' + Date.now()
      };
    }

    // 🔴 2. لو الملف PDF (بتاع نتايج التحاليل الأصلية لـ lab_results)
    return {
      folder: 'lab_results',
      resource_type: 'raw',
      format: 'pdf',
      public_id: 'result-' + Date.now()
    };
  }
});

const upload = multer({ storage: storage });
/***************************************** */

router.get('/profile', auth, labController.getProfile);

router.patch('/update-profile', auth, labController.updateProfile);


router.get('/my-services', auth, labController.getServices);

router.post(
  '/add-service', 
  auth,                   // 🟢 1. التأكد من الـ Token أولاً ويملا الـ req.user
  upload.single('imageUrl'), // 🟢 2. يفك الـ form-data ويرفع الصورة
  [
    // 3. مصفوفة الـ Validation بتاعتك
    check('name', 'Service name is required').notEmpty(),
    check('price', 'Price must be a number').isNumeric(),
    check('category', 'Category must be test or scan').isIn(['test', 'scan']),
    check('estimatedTime', 'Estimated time is required').notEmpty(),
  ], 
  // 4. فحص أخطاء الـ Validation
  (req, res, next) => {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }
    next();
  },
  labController.addService // 5. الـ Controller الأصلي اللي هيقرا req.user._id بأمان
);

router.patch('/toggle-service/:serviceId', auth, labController.toggleServiceStatus);

router.post('/add-request', auth, labController.createRequest);

router.get('/results-dashboard', auth, labController.getLabResultsDashboard);

router.post('/upload-result', auth, upload.single('resultFileUrl'), labController.uploadLabResult);

router.get('/lab-notifications', auth, notificationController.getLabNotificationsForUI);

router.get('/lab-notifications', auth, notificationController.getLabNotificationsForUI);


module.exports = router;