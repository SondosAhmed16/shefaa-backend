const express = require('express');
const router = express.Router();
const adminController = require('../Controllers/adminController');
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role'); 
const billingController = require('../controllers/billingController');

router.use(auth);
router.use(authorizeRoles('admin'));

router.get('/stats', adminController.getStats);


router.get('/users/pending', adminController.getPendingUsers);

router.get('/users', adminController.getAllUsers);

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
 
// ── NEW: Finance ─────────────────────────────────────────────────────────────
router.get('/finance/summary',              adminController.getFinanceSummary);
router.get('/finance/transactions',         adminController.getTransactions);
router.post('/finance/transactions',        adminController.createTransaction);
router.get('/finance/revenue-per-month',    adminController.getRevenuePerMonth);
 
// ── NEW: Settings ─────────────────────────────────────────────────────────────
router.get('/settings',                     adminController.getSettings);
router.patch('/settings',                   adminController.updateSettings);
 
// ── NEW: Global search ────────────────────────────────────────────────────────
router.get('/search',                       adminController.globalSearch);
router.get('/appointments/specializations', adminController.getAppointmentSpecializations);



// Billing routes
router.get('/billing/summary',               billingController.getBillingSummary);
router.get('/billing/records',               billingController.getBillingRecords);
router.patch('/billing/records/:id/pay',     billingController.markPaid);
router.patch('/billing/records/:id/suspend', billingController.suspendForNonPayment);
router.post('/billing/generate',             billingController.generateMonthlyBilling);
module.exports = router;