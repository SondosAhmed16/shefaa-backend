const express = require('express');
const router = express.Router();
const pharmacyController = require('../Controllers/pharmacyController');
const ai=require('../Controllers/pharmacyDailyai')
const ai2=require('../Controllers/stockAlertChat')
const context=require('../Controllers/Aicontextcontroller')
const pharmacyBilling = require("../Controllers/pharmacyBillingController");
const financeAI = require("../Controllers/pharmacyFinanceAI");
// Importing Middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

router.get('/dashboard-stats', auth, pharmacyController.getDashboardStats);
router.get('/patient/search', auth, pharmacyController.patientSearch);
router.get('/orders/track/:orderId', auth, pharmacyController.getOrderTracking);

// ─── Profile ───────────────────────────────────────────────────────────────
router.get('/profile',          auth, authorizeRoles('pharmacy'), pharmacyController.getProfile);
router.patch('/profile',        auth, authorizeRoles('pharmacy'), pharmacyController.updateProfile);

// ─── Settings ──────────────────────────────────────────────────────────────
router.patch('/settings/status',   auth, authorizeRoles('pharmacy'), pharmacyController.toggleOpenStatus);
router.patch('/settings/delivery', auth, authorizeRoles('pharmacy'), pharmacyController.toggleDeliveryService);

// ─── Orders ────────────────────────────────────────────────────────────────
router.get('/orders',                          auth, authorizeRoles('pharmacy'), pharmacyController.getOrders);
router.patch('/orders/:orderId/accept',        auth, authorizeRoles('pharmacy'), pharmacyController.acceptOrder);
router.patch('/orders/:orderId/ready',         auth, authorizeRoles('pharmacy'), pharmacyController.markOrderReady);
router.patch('/orders/:orderId/complete',      auth, authorizeRoles('pharmacy'), pharmacyController.completeOrder); // ← NEW

// ─── Inventory ─────────────────────────────────────────────────────────────
router.get('/inventory',                auth, authorizeRoles('pharmacy'), pharmacyController.getInventory);
router.get('/inventory/search',         auth, authorizeRoles('pharmacy'), pharmacyController.searchMedicines);
router.get('/inventory/low-stock',      auth, authorizeRoles('pharmacy'), pharmacyController.getLowStockAlerts);
router.post('/inventory/add',           auth, authorizeRoles('pharmacy'), pharmacyController.addMedicine);
router.put('/inventory/:id',            auth, authorizeRoles('pharmacy'), pharmacyController.updateMedicine);
router.patch('/inventory/:id/restock',  auth, authorizeRoles('pharmacy'), pharmacyController.restockMedicine);

// ─── Delivery Men ──────────────────────────────────────────────────────────
router.get('/delivery-men',           auth, authorizeRoles('pharmacy'), pharmacyController.getDeliveryMen);
router.get('/delivery-men/search',    auth, authorizeRoles('pharmacy'), pharmacyController.searchDeliveryMen);
router.get('/delivery-men/available', auth, authorizeRoles('pharmacy'), pharmacyController.getAvailableDeliveryMen);
router.get('/delivery-men/busy',      auth, authorizeRoles('pharmacy'), pharmacyController.getBusyDeliveryMen);
router.post('/delivery-men',          auth, authorizeRoles('pharmacy'), pharmacyController.addDeliveryMan);
router.put('/delivery-men/:id',       auth, authorizeRoles('pharmacy'), pharmacyController.updateDeliveryMan);
router.delete('/delivery-men/:id',    auth, authorizeRoles('pharmacy'), pharmacyController.deleteDeliveryMan);

// ─── City Delivery Pricing ─────────────────────────────────────────────────
router.get('/delivery-prices',          auth, authorizeRoles('pharmacy'), pharmacyController.getCityDeliveryPrices);    // ← NEW
router.post('/delivery-prices',         auth, authorizeRoles('pharmacy'), pharmacyController.upsertCityDeliveryPrice);  // ← NEW
router.delete('/delivery-prices/:city', auth, authorizeRoles('pharmacy'), pharmacyController.deleteCityDeliveryPrice);  // ← NEW

// ─── Financials ────────────────────────────────────────────────────────────
router.get('/financials',                          auth, authorizeRoles('pharmacy'), pharmacyController.getFinancials);
router.get('/financials/payment-history',          auth, authorizeRoles('pharmacy'), pharmacyController.getPaymentHistory);
router.get('/financials/monthly/:year/:month',     auth, authorizeRoles('pharmacy'), pharmacyController.getMonthlyDetail);
router.post('/financials/pay',                     auth, authorizeRoles('pharmacy'), pharmacyController.confirmPayment);
router.post('/finance/pay',                        auth, authorizeRoles('pharmacy'), pharmacyController.confirmPaymentAlias);

// ---------Ai------- 
router.post('/ai/daily-summary',   auth, authorizeRoles('pharmacy'), ai.generateDailySummary);
router.post('/ai/stock-alerts',    auth, authorizeRoles('pharmacy'), ai2.getSmartStockAlerts);
router.post('/ai/chat',            auth, authorizeRoles('pharmacy'), ai2.adminChatAssistant);
router.get(
  "/finance/report",
  auth,
  authorizeRoles("pharmacy"),
  financeAI.getFinanceReport
);
// routes file
router.get(
  "/ai/chat-context",
  auth,
  authorizeRoles("pharmacy"),
  context.getAIChatContextRoute  // ← غير ده بس
);


router.get( "/billing/summary", auth, authorizeRoles('pharmacy'), pharmacyBilling.getBillingSummary);
router.post("/billing/pay",     auth, authorizeRoles('pharmacy'), pharmacyBilling.payPlatformFee);
router.get( "/billing/history", auth, authorizeRoles('pharmacy'), pharmacyBilling.getBillingHistory);

module.exports = router;