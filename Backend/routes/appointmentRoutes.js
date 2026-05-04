const express = require('express');
const router = express.Router();
const appointmentController = require('../Controllers/appointmentController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');

router.post('/', auth, authorizeRoles('patient'), appointmentController.bookAppointment);
router.get('/my', auth, authorizeRoles('patient','doctor'), appointmentController.getMyAppointments);
router.patch('/:id/cancel', auth, authorizeRoles('patient','doctor'), appointmentController.cancelAppointment);
router.post('/:id/blockPatient', auth, authorizeRoles('doctor'), appointmentController.blockPatientForNoShow);
router.patch("/:id/mark-paid", auth, authorizeRoles('doctor'), appointmentController.markAppointmentAsPaid);
module.exports = router;