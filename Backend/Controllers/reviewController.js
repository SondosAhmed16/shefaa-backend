const Review = require('../Models/Review');
const Doctor = require('../Models/Doctors'); 
const Patient = require('../Models/Patients'); 
const Pharmacy = require('../Models/Pharmaces')
const { body, validationResult } = require('express-validator');
const logger = require('../config/loggerConfig'); 


exports.addReview = [
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5'),
  body('comment').optional().isLength({ max: 500 }),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { doctorId, rating, comment } = req.body;


      const patientProfile = await Patient.findOne({ userId: req.user._id });
      if (!patientProfile) {
        return res.status(404).json({ message: 'Patient profile not found. Please complete your profile.' });
      }

      const doctor = await Doctor.findById(doctorId);
      if (!doctor) return res.status(404).json({ message: 'Doctor not found' });

      const existing = await Review.findOne({ doctorId, patientId: patientProfile._id });
      if (existing) return res.status(400).json({ message: 'You already reviewed this doctor' });


      const review = new Review({
        patientId: patientProfile._id, 
        doctorId,
        rating,
        comment,
        date: new Date(),
      });

      await review.save();


      const reviews = await Review.find({ doctorId });
      const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      

      doctor.rating = avgRating; 
      await doctor.save();

      logger.info(`Review added by patient ${patientProfile._id} for doctor ${doctorId}`);
      res.status(201).json({ message: 'Review added successfully', review });
    } catch (err) {
      logger.error('Error adding review: ' + err.message);
      res.status(500).json({ message: 'Error adding review: ' + err.message });
    }
  },
];

exports.getDoctorReviews = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const reviews = await Review.find({ doctorId })
      .populate({
        path: 'patientId',
        select: 'userId', 
        populate: { path: 'userId', select: 'name' }
      })
      .sort({ createdAt: -1 });

    res.json(reviews);
  } catch (err) {
    logger.error('Error fetching doctor reviews: ' + err.message);
    res.status(500).json({ message: 'Error fetching reviews' });
  }
};


exports.getPatientReviews = async (req, res) => {
  try {
    const patientProfile = await Patient.findOne({ userId: req.user._id });
    if (!patientProfile) return res.status(404).json({ message: 'Patient profile not found' });

    const reviews = await Review.find({ patientId: patientProfile._id })
      .populate({
        path: 'doctorId',
        select: 'userId specialization',
        populate: { path: 'userId', select: 'name' }
      });

    res.json(reviews);
  } catch (err) {
    logger.error('Error fetching patient reviews: ' + err.message);
    res.status(500).json({ message: 'Error fetching reviews' });
  }
};


exports.updateReview = [
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('comment').optional().isLength({ max: 500 }),

  async (req, res) => {
    try {
      const { id } = req.params;
      const patientProfile = await Patient.findOne({ userId: req.user._id });

      const review = await Review.findById(id);
      if (!review) return res.status(404).json({ message: 'Review not found' });


      if (review.patientId.toString() !== patientProfile._id.toString()) {
        return res.status(403).json({ message: 'Not allowed to update this review' });
      }

      const updates = req.body;
      Object.assign(review, updates);
      await review.save();

      const reviews = await Review.find({ doctorId: review.doctorId });
      const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      await Doctor.findByIdAndUpdate(review.doctorId, { rating: avgRating });

      logger.info(`Review ${id} updated by patient ${patientProfile._id}`);
      res.json({ message: 'Review updated successfully', review });
    } catch (err) {
      logger.error('Error updating review: ' + err.message);
      res.status(500).json({ message: 'Error updating review' });
    }
  },
];

exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const patientProfile = await Patient.findOne({ userId: req.user._id });

    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: 'Review not found' });

    if (review.patientId.toString() !== patientProfile._id.toString()) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    const doctorId = review.doctorId;
    await review.deleteOne();

    const reviews = await Review.find({ doctorId });
    const avgRating = reviews.length > 0 
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
      : 0;
    
    await Doctor.findByIdAndUpdate(doctorId, { rating: avgRating });

    logger.info(`Review ${id} deleted by patient ${patientProfile._id}`);
    res.json({ message: 'Review deleted successfully' });
  } catch (err) {
    logger.error('Error deleting review: ' + err.message);
    res.status(500).json({ message: 'Error deleting review' });
  }
};

exports.addPharmacyReview = async (req, res) => {
  try {
    const { pharmacyId, rating, comment } = req.body;
    
    const patientProfile = await Patient.findOne({ userId: req.user._id || req.user.id });
    if (!patientProfile) {
      return res.status(404).json({ message: 'Patient profile not found.' });
    }

    const existingReview = await Review.findOne({ pharmacyId, patientId: patientProfile._id });
    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this pharmacy.' });
    }

    const review = new Review({
      patientId: patientProfile._id,
      pharmacyId, 
      rating,
      comment
    });
    await review.save();
    
    const reviews = await Review.find({ pharmacyId });
    const totalReviews = reviews.length; 
    
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews;

    await Pharmacy.findByIdAndUpdate(pharmacyId, { 
      rating: Number(avgRating.toFixed(1)), 
      totalReviews: totalReviews 
    });

    res.status(201).json({ message: 'Review added successfully', review });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};