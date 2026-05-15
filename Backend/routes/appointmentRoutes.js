const express = require('express');
const router = express.Router();
const appointmentController = require('../Controllers/appointmentController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');

router.post('/', auth, authorizeRoles('patient'), appointmentController.bookAppointment);
router.get("/fee-summary", auth, authorizeRoles('doctor', 'admin'), appointmentController.getDoctorFeeSummary);
router.get('/my', auth, authorizeRoles('patient','doctor'), appointmentController.getMyAppointments);
router.patch('/:id/cancel', auth, authorizeRoles('patient','doctor'), appointmentController.cancelAppointment);
router.post('/:id/blockPatient', auth, authorizeRoles('doctor'), appointmentController.blockPatientForNoShow);
router.patch("/:id/mark-paid", auth, authorizeRoles('doctor'), appointmentController.markAppointmentAsPaid);
router.post("/prescription", auth, authorizeRoles('doctor'),appointmentController.createPrescription);
router.get("/:appointmentId/getPrescription", auth, authorizeRoles('doctor','patient'),appointmentController.getPrescriptionByAppointment);
router.patch("/:id/complete", auth, authorizeRoles('doctor'), appointmentController.completeAppointment);
router.get("/:id/getPreviousPrescription", auth, authorizeRoles('doctor'), appointmentController.getPreviousPrescription);
router.patch("/:id/updatePrescription", auth, authorizeRoles('doctor'), appointmentController.updatePrescription);
router.patch("/:id/reschedule", auth, authorizeRoles('patient'), appointmentController.rescheduleAppointment);
module.exports = router;