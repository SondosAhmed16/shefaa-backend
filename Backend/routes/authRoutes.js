const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const multer = require("multer"); 
const path = require("path");
const fs = require("fs"); // 1. لازم نستدعي مكتبة الـ fs

const authController = require("../Controllers/authController");
const { runValidation } = require("../middleware/validate");

// --- 2. إعدادات تخزين الملف مع التأكد من وجود المسار ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/memberships/';
    
    // الحل الجذري: لو الفولدر مش موجود، الكود هيكريته فوراً
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('عفواً، مسموح فقط بملفات PDF!'), false);
    }
  }
});

// --- 3. راوت الـ Register ---
router.post(
  "/register",
  upload.single('membership'), // التأكد إن الاسم هنا 'membership'
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
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
