const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require('fs'); // ضيفي دي فوق خالص مع الـ imports لو مش موجودة
const User = require('../Models/Users');
const Patient = require('../Models/Patients');
const Doctor = require('../Models/Doctors');
const Pharmacy = require('../Models/Pharmaces');
const Lab = require('../Models/Labs');
const RefreshToken = require("../Models/RefreshToken");
const PasswordReset = require("../Models/PasswordReset");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/tokens");

const { sendVerificationEmail } = require("../utils/sendEmail");


// Register 
exports.register = async (req, res) => {
  try {
    const { name, username, email, password, role, phoneNumber, address, age, gender } = req.body;

    // 1. Auto hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 2. create user
    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      role: role || 'patient',
      isVerified: true
    });

    // 3. Create Profile based on role
    if (user.role === 'patient') {
      await Patient.create({
        userId: user._id,
        phoneNumber: phoneNumber,
      });
    } else if (user.role === 'doctor') {
      const pdfUrl = req.file ? req.file.path : "";

      await Doctor.create({
        userId: user._id,
        specialization: req.body.specialization || "General",
        age: req.body.age || 30,
        yearsOfExperience: req.body.yearsOfExperience || 0,
        paymentOption: req.body.paymentOption || "in_clinic",
        membershipPdf: pdfUrl, // حفظ المسار
        about: req.body.about || "",
        preOnlineConsultation: req.body.preOnlineConsultation || false
      });
    }
    else if (user.role === 'pharmacy') {
      await Pharmacy.create({
        userId: user._id,
        licence: req.body.licence || "N/A",
        registrationNumber: req.body.registrationNumber || "N/A",
        commercialRegisterNumber: req.body.commercialRegisterNumber || `COM-${Date.now()}`,
        addresses: req.body.addresses || []
      });
    }
    else if (user.role === 'lab') {
      await Lab.create({
        userId: user._id,
        licence: req.body.licence || "N/A",
        registrationNumber: req.body.registrationNumber || "N/A",
        commercialRegisterNumber: req.body.commercialRegisterNumber || `LAB-${Date.now()}`
      });
    }

    // 4. توليد التوكن والرد مع تاريخ الانتهاء الإلزامي
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 أيام
    });

    res.status(201).json({
      message: "User registered successfully",
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, role: user.role }
    });

  } catch (err) {
    console.log(err); // هيطبع الغلط بالتفصيل في الـ Terminal عندك
    res.status(500).json({
      message: err.message, // هيظهر لك سبب المشكلة الحقيقي في Postman
      error: err
    });
  }
};
// Login 
exports.login = async (req, res) => {
  try {
    const { identity, password } = req.body;


    let user = await User.findOne({ email: identity });

    if (!user) {
      const patient = await Patient.findOne({ phoneNumber: identity });
      if (patient) {
        user = await User.findById(patient.userId);
      }
    }

    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.json({ accessToken, refreshToken });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


//Refresh token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    const tokenDoc = await RefreshToken.findOne({ token: refreshToken });
    if (!tokenDoc || tokenDoc.expiresAt < new Date())
      return res.status(403).json({ message: "Invalid refresh token" });

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    const newAccessToken = generateAccessToken(user);
    res.json({ accessToken: newAccessToken });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// Forgot Password 
exports.forgotPassword = async (req, res) => {
  try {
    const { identity } = req.body;
    const user = await User.findOne({ email: identity });
    if (!user) return res.status(404).json({ message: "User not found" });

    const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedCode = crypto.createHash("sha256").update(verificationCode).digest("hex");

    await PasswordReset.deleteMany({ user: user._id });

    await PasswordReset.create({
      user: user._id,
      tokenHash: hashedCode,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await sendVerificationEmail(user.email, verificationCode);
    res.status(200).json({ message: "Verification code sent to your email" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// verify reset code
exports.verifyResetCode = async (req, res) => {
  try {
    const { identity, code } = req.body;
    const user = await User.findOne({ email: identity });
    if (!user) return res.status(400).json({ message: "Invalid request" });

    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

    const resetEntry = await PasswordReset.findOne({
      user: user._id,
      tokenHash: hashedCode,
      expiresAt: { $gt: Date.now() }
    });

    if (!resetEntry) return res.status(400).json({ message: "Invalid or expired code" });

    res.status(200).json({ message: "Code verified successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
const { identity, code, newPassword } = req.body; 
    const user = await User.findOne({ email: identity });
    if (!user) return res.status(400).json({ message: "Invalid request" });

    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

    const resetEntry = await PasswordReset.findOne({
      user: user._id,
      tokenHash: hashedCode,
      expiresAt: { $gt: Date.now() }
    });

    if (!resetEntry) return res.status(400).json({ message: "Invalid or expired code" });

    user.password = newPassword;
    await user.save();

    await PasswordReset.deleteOne({ _id: resetEntry._id });

    res.status(200).json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


//Logout 
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    await RefreshToken.deleteOne({ token: refreshToken });
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



