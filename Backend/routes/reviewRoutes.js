const express = require('express');
const router = express.Router();
const reviewController = require('../Controllers/reviewController'); 
const { auth } = require('../middleware/auth'); 


router.post('/', auth, reviewController.addReview);

router.get('/doctor/:doctorId', reviewController.getDoctorReviews);

router.get('/me', auth, reviewController.getPatientReviews);

router.put('/:id', auth, reviewController.updateReview);

router.delete('/:id', auth, reviewController.deleteReview);

router.post('/pharmacy', auth, reviewController.addPharmacyReview);

module.exports = router;