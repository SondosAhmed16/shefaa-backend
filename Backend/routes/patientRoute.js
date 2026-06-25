const express = require('express');
const router = express.Router();

const patientController = require('../Controllers/patientController');
const appointmentController = require('../Controllers/appointmentController');
const notificationController = require('../Controllers/notificationController');
const reviewController = require('../Controllers/reviewController');


const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');
const { upload } = require('../middleware/upload');

router.get('/profile', auth, authorizeRoles('patient'), patientController.getProfile);


router.put('/profile/basic-info', auth, patientController.updateBasicInfo);

router.put('/profile/medical-info', auth, patientController.updateMedicalInfo);

router.put('/profile', auth, authorizeRoles('patient', 'doctor'), runValidation, patientController.updateProfile);

router.get('/medications', auth, patientController.getMedications);

router.post('/medications', auth, patientController.addMedication);

//router.get('/appointments', auth, authorizeRoles('patient'), patientController.getAppointments);
router.get('/notifications', auth, notificationController.getMyNotifications);

router.patch('/notifications/:id/read', auth, notificationController.markAsRead);

router.post('/upload-scan', auth, authorizeRoles('patient'), upload.single("scan"), patientController.uploadAttachment);

router.get('/medical-history', auth, authorizeRoles('patient'), patientController.getMedicalHistory);

router.post('/medications/:medId/confirm', auth, patientController.confirmMedicationDose);

router.put('/medications/:medId', auth, authorizeRoles('patient'), patientController.updateMedication);

router.delete('/medications/:medId', auth, authorizeRoles('patient'), patientController.deleteMedication);

router.get('/my-medications', auth, patientController.getMyMedications);

// pharmacies

router.get('/pharmacies/search', auth, authorizeRoles('patient'), patientController.searchPharmaciesAndMedicines);

router.get('/pharmacies/:id/profile', auth, authorizeRoles('patient'), patientController.getPharmacyProfileForPatient);

router.get('/pharmacies/:id/medicines', auth, authorizeRoles('patient'), patientController.getPharmacyMedicinesForPatient);

router.get('/medicines/:medId', auth, authorizeRoles('patient'), patientController.getMedicineDetailsForPatient);

router.post('/cart/checkout', auth, authorizeRoles('patient'), patientController.createOrder);

router.post('/cart/payment-online', auth, authorizeRoles('patient'), patientController.processOnlinePayment);

router.get('/orders/track/:orderId', auth, authorizeRoles('patient'), patientController.getPatientOrderTracking);

router.post('/orders/confirm-receipt', auth, authorizeRoles('patient'), patientController.confirmOrderReceipt);

router.post('/pharmacies/review', auth, authorizeRoles('patient'), reviewController.addPharmacyReview);

// labs

router.get('/search-centers', auth, patientController.patientSearch);

router.get('/my-lab-results', auth, patientController.getPatientLabResults);

module.exports = router;