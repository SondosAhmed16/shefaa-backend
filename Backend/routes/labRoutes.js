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



const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    if (file.mimetype.startsWith('image/')) {
      const fileExtension = file.mimetype.split('/')[1]; 
      return {
        folder: 'lab_services_images', 
        resource_type: 'image',
        format: fileExtension,
        public_id: 'service-' + Date.now()
      };
    }

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
  upload.single('imageUrl'), 
  [
    check('name', 'Service name is required').notEmpty(),
    check('price', 'Price must be a number').isNumeric(),
    check('category', 'Category must be test or scan').isIn(['test', 'scan']),
    check('estimatedTime', 'Estimated time is required').notEmpty(),
  ], 
  (req, res, next) => {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }
    next();
  },
  labController.addService 
);

router.patch('/toggle-service/:serviceId', auth, labController.toggleServiceStatus);

router.post('/add-request', auth, labController.createRequest);

router.get('/results-dashboard', auth, labController.getLabResultsDashboard);

router.post('/upload-result', auth, upload.single('resultFileUrl'), labController.uploadLabResult);

router.get('/lab-notifications', auth, notificationController.getLabNotificationsForUI);

router.patch('/notification-settings', auth, labController.updateNotificationSettings);

router.get('/dashboard', auth, labController.getLabDashboardForUI);

module.exports = router;