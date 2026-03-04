const express = require('express');
const router = express.Router();
const doctorController = require('../Controllers/doctorController');
const appointmentController = require('../Controllers/appointmentController');
const { auth } = require('../middleware/auth'); 


router.get(
  '/search-doctors', 
  auth, 
  doctorController.searchDoctors 
);

router.post(
  '/', 
  auth, 

  appointmentController.bookAppointment
);



router.get(
  '/my', 
  auth, 
  appointmentController.getAppointments
);


router.delete(
  '/:id', 
  auth, 
  appointmentController.cancelAppointment
);


/*router.put(
  '/confirm/:id', 
  auth, 
  appointmentController.confirmAppointment
);*/

module.exports = router;