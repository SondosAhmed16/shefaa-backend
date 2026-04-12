const express = require('express');
const router = express.Router();
const multer = require('multer');
const labController = require('../Controllers/LabReportController');

// Set up memory storage for the uploaded file
const upload = multer({ storage: multer.memoryStorage() });

// Define the POST route
// 'labReport' is the key you will use in Flutter/Postman
router.post('/analyze', upload.single('labReport'), labController.analyzeReport);

module.exports = router;