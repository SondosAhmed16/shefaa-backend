const express = require('express');
const router = express.Router();
const appointmentController = require('../Controllers/appointmentController');
const { auth } = require('../middleware/auth'); 


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