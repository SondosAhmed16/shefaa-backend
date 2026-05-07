const express = require('express');
const router = express.Router();
const pharmacyController = require('../Controllers/pharmacyController');

// Importing Middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

router.get('/dashboard-stats', auth, pharmacyController.getDashboardStats);

router.get('/profile', auth, pharmacyController.getProfile);

router.patch('/settings', auth, pharmacyController.updateProfileSettings);

router.get('/inventory', auth, pharmacyController.getInventory); 

router.post('/inventory/add', auth, pharmacyController.addMedicine);

//router.put('/inventory/update/:id', auth, pharmacyController.updateMedicine);

//router.delete('/inventory/delete/:id', auth, pharmacyController.deleteMedicine);

//router.get('/prescriptions', auth, pharmacyController.getNewPrescriptions);

//router.get('/prescriptions/:id', auth, pharmacyController.getPrescriptionDetails);

//router.post('/prescriptions/confirm', auth, pharmacyController.confirmPrescriptionOrder);

//router.get('/inventory/alternatives', auth, pharmacyController.findAlternative);

router.get('/orders', auth, pharmacyController.getOrders);

router.patch('/orders/:orderId/status', auth, pharmacyController.updateOrderStatus);

router.get('/patient/search', auth, pharmacyController.patientSearch);

router.get('/orders/track/:orderId', auth, pharmacyController.getOrderTracking);

//router.get('/search', pharmacyController.searchMedicines); 

module.exports = router;