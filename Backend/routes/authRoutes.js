const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

const authController = require("../Controllers/authController");
const { runValidation } = require("../middleware/validate");

// إعدادات Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// في ملف authRoutes.js
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'doctor_memberships',
    resource_type: 'raw', // ده اللي بيخلي Cloudinary يقبل الـ PDF
    format: async (req, file) => 'pdf', // إجبار التنسيق يكون pdf
    public_id: (req, file) => 'membership-' + Date.now(),
  },
});

const upload = multer({ storage: storage });

// --- الراوتس ---

router.post(
  "/register",
  upload.single('membership'), 
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  runValidation,
  authController.register
);

router.post(
  "/login",
  [
    body("identity").notEmpty().withMessage("Email or Phone number is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  runValidation,
  authController.login
);
// Forgot password - تعديل الـ Validation
router.post(
  "/forgot-password",
  [
    body("identity").notEmpty().withMessage("Email or Phone number is required"),
  ],
  runValidation,
  authController.forgotPassword
);

// Reset password
router.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Token is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  runValidation,
  authController.resetPassword
);

// Refresh token
router.post("/refresh", authController.refreshToken);

// Logout
router.post("/logout", authController.logout);

module.exports = router;
