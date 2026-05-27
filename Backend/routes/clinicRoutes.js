// routes/clinicRoutes.js
const express = require('express');
const router = express.Router();
const clinicController = require('../Controllers/clinicController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');

// Create clinic
router.post('/', auth, authorizeRoles('doctor'), clinicController.createClinic);

// Get clinic by id
router.get('/:id', auth, authorizeRoles('patient', 'doctor'), clinicController.getClinic);

// Update clinic
router.put('/:id', auth, authorizeRoles('doctor'), clinicController.editClinic);

// Delete clinic
router.delete('/:id', auth, authorizeRoles('doctor'), clinicController.deleteClinic);

// Get available slots for a specific day
// GET /api/clinic/:id/day-slots?date=YYYY-MM-DD
router.get('/:id/day-slots', auth, authorizeRoles('patient', 'doctor'), clinicController.getDaySlots);


// routes/clinicRoutes.js
router.get("/:id/today", auth, authorizeRoles('patient'), clinicController.getClinicWithTodaySlots);

module.exports = router;