const express = require('express');
const router = express.Router();

const patientController = require('../Controllers/patientController');

const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');
const { upload } = require('../middleware/upload'); 

router.get('/profile', auth, authorizeRoles('patient'), patientController.getProfile);


router.put('/profile', auth, authorizeRoles('patient'), runValidation, patientController.updateProfile);


//router.get('/appointments', auth, authorizeRoles('patient'), patientController.getAppointments);


router.post('/upload-scan', auth, authorizeRoles('patient'), upload.single("scan"), patientController.uploadAttachment);

router.get('/medical-history', auth, authorizeRoles('patient'), patientController.getMedicalHistory);

module.exports = router;