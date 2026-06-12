const express = require('express');
const router = express.Router();
const labController = require('../Controllers/labController');
const { auth } = require('../middleware/auth'); 
const { runValidation } = require('../middleware/validate'); 
const { body } = require('express-validator'); 
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// إعداد التخزين
// التعديل المظبوط جوه ملفك مباشرة بدون أي require خارجي
const storage = new CloudinaryStorage({
  cloudinary: cloudinary, // بيقرأ من متغير الكلاوديناري اللي عندك فوق في الملف أصلاً
  params: async (req, file) => {
    
    // 1. لو الملف اللي مبعوت صورة (زي الأشعة التوضيحية للخدمة)
    if (file.mimetype.startsWith('image/')) {
      const fileExtension = file.mimetype.split('/')[1]; // png, jpeg, jpg
      return {
        folder: 'lab_services_images', // الفولدر الجديد للصور
        resource_type: 'image',        // نوع الحساب هنا صورة
        format: fileExtension,         
        public_id: 'service-' + Date.now()
      };
    }

    // 2. لو الملف PDF (بتاع نتايج التحاليل اللي كنتِ عاملاه في الأصل)
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
  auth, 
  [
    body("name").notEmpty().withMessage("Service name is required"),
    body("price").isNumeric().withMessage("Price must be a number"),
    body("category").isIn(["test", "scan"]).withMessage("Category must be test or scan"),
    body("estimatedTime").notEmpty().withMessage("Estimated time is required")
  ],
  runValidation, 
  labController.addService
);

router.patch('/toggle-service/:serviceId', auth, labController.toggleServiceStatus);

router.post('/add-request', auth, labController.createRequest);

module.exports = router;