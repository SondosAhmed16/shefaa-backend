const express = require('express');
const router = express.Router();
const clinicController = require('../Controllers/clinicController');

const { auth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { runValidation } = require('../middleware/validate');



// 3. add new clinic
router.post('/', auth, authorizeRoles('doctor'), clinicController.createClinic);


// 5. update clinic
router.put('/:id', auth, authorizeRoles('doctor'), clinicController.editClinic);

// // 6. delete clinic
// router.delete('/:id', auth, authorizeRoles('doctor'), clinicController.deleteClinic);

module.exports = router;