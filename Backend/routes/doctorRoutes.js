const express = require('express');
const router = express.Router();
const doctorController = require('../Controllers/doctorController');

// Importing your middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

// 1. Profile Routes
router.get('/profile', auth, authorizeRoles('doctor'), doctorController.getDoctorProfile);
router.put('/profile', auth, authorizeRoles('doctor'), runValidation, doctorController.updateDoctorProfile);
// داخل ملف doctorRoutes.js
router.get('/search-doctors', doctorController.searchDoctors);

// 2. Clinic Management

//router.post('/add-clinic', auth, authorizeRoles('doctor'), runValidation, doctorController.addClinic);

// 3. Appointments & Medical Records
// Get data for the doctor's dashboard (Stats, Today's appointments, and Requests)
router.get('/doctorDashboard', auth, authorizeRoles('doctor'), doctorController.getDoctorDashboard);

//router.get('/appointments', auth, authorizeRoles('doctor'), doctorController.getAppointments);
router.post('/add-medical-record', auth, authorizeRoles('doctor'), runValidation, doctorController.addMedicalRecord);

module.exports = router;