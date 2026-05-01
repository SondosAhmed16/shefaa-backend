const express = require('express');
const router = express.Router();
const appointmentController = require('../Controllers/appointmentController');
const { auth } = require('../middleware/auth');

const { authorizeRoles } = require('../middleware/role');

// ─── Appointments (patients only) ────────────────────────────────────────────
router.post('/', auth, authorizeRoles('patient'), appointmentController.bookAppointment);
router.get('/my', auth, appointmentController.getAppointments);
router.patch('/:id/cancel', auth, authorizeRoles('patient'), appointmentController.cancelAppointment);

module.exports = router;