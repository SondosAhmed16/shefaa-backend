const express = require('express');
const router = express.Router();
const adminController = require('../Controllers/adminController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role'); 

router.use(auth);
router.use(authorizeRoles('admin'));

router.get('/stats', adminController.getStats);

router.get('/users', adminController.getAllUsers);

router.get('/users/pending', adminController.getPendingUsers);

router.patch('/users/activate/:id', adminController.activateUser);

router.patch('/users/deactivate/:id', adminController.deactivateUser);

router.delete('/users/:id', adminController.deleteUser);

router.get('/logs', adminController.getSystemLogs);

router.post('/cleanup', adminController.cleanup);

router.get('/users/role/:role', adminController.getUsersByRole);

// ─── NEW ROUTES ───────────────────────────────────────────────────────────────

router.get('/patients', adminController.getPatients);
router.get('/doctors', adminController.getDoctors);
router.get('/labs', adminController.getLabs);
router.get('/pharmacies', adminController.getPharmacies);
router.get('/appointments/summary', adminController.getAppointmentsSummary);
router.get('/platform-health', adminController.getPlatformHealth);
router.get('/recent-activity', adminController.getRecentActivity);
router.get('/registrations-per-month', adminController.getRegistrationsPerMonth);
router.get('/top-specializations', adminController.getTopSpecializations);

module.exports = router;