const express = require('express');
const router = express.Router();
const chatbootController = require('../Controllers/chatbootController');

router.post('/chat', chatbootController.medicalChat); 
module.exports = router;