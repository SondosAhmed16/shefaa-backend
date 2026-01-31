const express = require("express");
const router = express.Router();
const { body } = require("express-validator");

const authController = require("../Controllers/authController");
const { runValidation } = require("../middleware/validate");

// Register
router.post(
  "/register",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role")
      .optional()
      .isIn(["doctor", "patient", "pharmacy", "lab", "admin"])
      .withMessage("Invalid role"),
  ],
  runValidation,
  authController.register
);

// Login - تعديل الـ Validation ليقبل إيميل أو تليفون
router.post(
  "/login",
  [
    // غيرنا email لـ identity وشلنا شرط الـ isEmail
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
