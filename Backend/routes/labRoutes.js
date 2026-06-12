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