const express = require('express');
const router = express.Router();
const clinicController = require('../Controllers/clinicController');

const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

// Create clinic
router.post('/', auth, authorizeRoles('doctor'), clinicController.createClinic);

// Get clinic by id
router.get('/:id', auth, authorizeRoles('doctor'), clinicController.getClinic);

// Update clinic
router.put('/:id', auth, authorizeRoles('doctor'), clinicController.editClinic);

// Delete clinic
router.delete('/:id', auth, authorizeRoles('doctor'), clinicController.deleteClinic);

// Week schedule override (create/update)
router.patch("/:id/schedule/override", auth, authorizeRoles('doctor'), clinicController.overrideWeekSchedule);

// Week schedule override (remove — restores default)
router.delete("/:id/schedule/override", auth, authorizeRoles('doctor'), clinicController.deleteWeekOverride);

// Manually flag a specific day as having appointments (or not).
// Used until real appointment booking is wired up.
// PATCH /api/clinic/:id/day-appointments
// Body: { weekStart: "ISO date string", day: "Monday", hasAppointments: true }
router.patch("/:id/day-appointments", auth, authorizeRoles('doctor'), clinicController.setDayAppointmentFlag);

module.exports = router;