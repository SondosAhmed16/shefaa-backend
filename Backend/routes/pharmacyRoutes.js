const express = require('express');
const router = express.Router();
const pharmacyController = require('../Controllers/pharmacyController');

// Importing Middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

router.get('/dashboard-stats', auth, pharmacyController.getDashboardStats);

router.get('/patient/search', auth, pharmacyController.patientSearch);

router.get('/orders/track/:orderId', auth, pharmacyController.getOrderTracking);

//router.get('/search', pharmacyController.searchMedicines); 

/////////////////////////////////////////////////////////////////////
router.get('/profile', auth, authorizeRoles('pharmacy'), pharmacyController.getProfile);
router.get('/orders',                            auth, authorizeRoles('pharmacy'), pharmacyController.getOrders);
router.patch('/orders/:orderId/accept',          auth, authorizeRoles('pharmacy'), pharmacyController.acceptOrder);
router.patch('/orders/:orderId/ready',           auth, authorizeRoles('pharmacy'), pharmacyController.markOrderReady);
router.get('/inventory',                    auth, authorizeRoles('pharmacy'), pharmacyController.getInventory);
router.get('/inventory/search',             auth, authorizeRoles('pharmacy'), pharmacyController.searchMedicines);
router.get('/inventory/low-stock',          auth, authorizeRoles('pharmacy'), pharmacyController.getLowStockAlerts);
router.patch('/inventory/:id/restock',      auth, authorizeRoles('pharmacy'), pharmacyController.restockMedicine);
router.post('/inventory/add',               auth, authorizeRoles('pharmacy'), pharmacyController.addMedicine);
router.put('/inventory/:id',                auth, authorizeRoles('pharmacy'), pharmacyController.updateMedicine);
router.get('/delivery-men',              auth, authorizeRoles('pharmacy'), pharmacyController.getDeliveryMen);
router.get('/delivery-men/search',       auth, authorizeRoles('pharmacy'), pharmacyController.searchDeliveryMen);
router.get('/delivery-men/available',    auth, authorizeRoles('pharmacy'), pharmacyController.getAvailableDeliveryMen);
router.get('/delivery-men/busy',         auth, authorizeRoles('pharmacy'), pharmacyController.getBusyDeliveryMen);
router.post('/delivery-men',             auth, authorizeRoles('pharmacy'), pharmacyController.addDeliveryMan);
router.put('/delivery-men/:id',          auth, authorizeRoles('pharmacy'), pharmacyController.updateDeliveryMan);
router.delete('/delivery-men/:id',       auth, authorizeRoles('pharmacy'), pharmacyController.deleteDeliveryMan);
router.patch('/profile',                   auth, authorizeRoles('pharmacy'), pharmacyController.updateProfile);
router.patch('/settings/status',           auth, authorizeRoles('pharmacy'), pharmacyController.toggleOpenStatus);
router.patch('/settings/delivery',         auth, authorizeRoles('pharmacy'), pharmacyController.toggleDeliveryService);
module.exports = router;