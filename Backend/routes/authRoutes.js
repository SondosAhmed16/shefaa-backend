const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

const passport = require('passport');
const { generateAccessToken, generateRefreshToken } = require("../utils/tokens");
const RefreshToken = require("../Models/RefreshToken");

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const authController = require("../Controllers/authController");
const { runValidation } = require("../middleware/validate");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shefaa_documents',
    resource_type: 'raw',
    format: async (req, file) => 'pdf',
    public_id: (req, file) => file.fieldname + '-' + Date.now(),
  },
});

const upload = multer({ storage: storage });


/************************************* */


router.post("/google/mobile", async (req, res) => {
  const { idToken } = req.body; 

  try {

    const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found. Please register first." });
    }

    if (!user.isVerified) {
      return res.status(403).json({ success: false, message: "Account pending review" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });


    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, role: user.role }
    });

  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid Google Token" });
  }
});

/*************************************** */

router.post(
  "/register",
  upload.fields([
    { name: 'membership', maxCount: 1 },
    { name: 'medicalLicence', maxCount: 1 }
  ]),
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("role").isIn(['patient', 'doctor', 'pharmacy', 'lab']).withMessage("Invalid role"),
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
    body("commercialRegisterNumber").custom((value, { req }) => {
      if (['pharmacy', 'lab'].includes(req.body.role) && !value) {
        throw new Error("Commercial Register Number is required for this role");
      }
      return true;
    }),
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
// Forgot password 
router.post(
  "/forgot-password",
  [
    body("identity").notEmpty().withMessage("Email or Phone number is required"),
  ],
  runValidation,
  authController.forgotPassword
);

// Verify Reset Code 
router.post(
  "/verify-reset-code",
  [
    body("identity").notEmpty().withMessage("Identity is required"),
    body("code").isLength({ min: 4, max: 4 }).withMessage("Verification code must be 4 digits"),
  ],
  runValidation,
  authController.verifyResetCode
);

// Reset password 
router.post(
  "/reset-password",
  [
    body("identity").notEmpty().withMessage("Identity is required"),
    body("code").notEmpty().withMessage("Verification code is required"),
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
