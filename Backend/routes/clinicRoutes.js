const express = require('express');
const router = express.Router();
const clinicController = require('../Controllers/clinicController');

const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');



// 3. add new clinic
router.post('/', auth, authorizeRoles('doctor'), clinicController.createClinic);

//get clinic by id
router.get('/:id', auth, authorizeRoles('doctor'),  clinicController.getClinic);

// 5. update clinic
router.put('/:id', auth, authorizeRoles('doctor'), clinicController.editClinic);

// 6. delete clinic
router.delete('/:id', auth, authorizeRoles('doctor'), clinicController.deleteClinic);

// routes/clinicRoutes.js
router.patch("/:id/schedule/override", auth, authorizeRoles('doctor'), clinicController.overrideWeekSchedule);
router.delete("/:id/schedule/override", auth, authorizeRoles('doctor'), clinicController.deleteWeekOverride);

module.exports = router;