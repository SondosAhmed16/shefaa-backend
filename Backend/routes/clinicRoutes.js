const express = require('express');
const router = express.Router();
const clinicController = require('../Controllers/clinicController');

const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');

// routes for doctor and patient

// // 1. get all clinics
// router.get('/', clinicController.getAllClinics);

// // 2. get specific clinic
// router.get('/:id', clinicController.getClinicById);


// routes for doctor only

// 3. add new clinic
router.post('/', auth, authorizeRoles('doctor'), clinicController.createClinic);

// 4.get all my clinics
// router.get('/my/all', auth, authorizeRoles('doctor'), clinicController.getDoctorClinics);

// // 5. update clinic
// router.put('/:id', auth, authorizeRoles('doctor'), clinicController.updateClinic);

// // 6. delete clinic
// router.delete('/:id', auth, authorizeRoles('doctor'), clinicController.deleteClinic);

module.exports = router;