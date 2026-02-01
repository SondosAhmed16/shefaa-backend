const express = require('express');
const router = express.Router();
const pharmacyController = require('../Controllers/pharmacyController');

// Importing Middlewares
const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

// 1. Stock Management (For the logged-in Pharmacy)

// Get all medicine in the pharmacy's stock
router.get('/stock', auth, authorizeRoles('pharmacy'), pharmacyController.getStock);

// Add a new medicine to the stock
router.post('/add-medicine', auth, authorizeRoles('pharmacy'), runValidation, pharmacyController.addMedicine);

// Update medicine quantity or price by stock ID
router.put('/update-medicine/:id', auth, authorizeRoles('pharmacy'), runValidation, pharmacyController.updateMedicine);

// Delete medicine from stock
router.delete('/delete-medicine/:id', auth, authorizeRoles('pharmacy'), pharmacyController.deleteMedicine);

// 2. Pharmacy Operations

// Search for medicines in all pharmacies (Public or Patient access)
router.get('/search', pharmacyController.searchMedicines);

// Dispense medicine (Reduce quantity after selling)
router.post('/dispense', auth, authorizeRoles('pharmacy'), pharmacyController.dispenseMedicine);

module.exports = router;