const express = require('express');
const router = express.Router();
const appointmentController = require('../Controllers/appointmentController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');

router.post('/', auth, authorizeRoles('patient'), appointmentController.bookAppointment);
router.get('/my', auth, authorizeRoles('patient','doctor'), appointmentController.getMyAppointments);
router.patch('/:id/cancel', auth, authorizeRoles('patient'), appointmentController.cancelAppointment);
router.post('/:appointmentId/blockPatient', auth, authorizeRoles('doctor'), appointmentController.blockPatientForNoShow);
module.exports = router;