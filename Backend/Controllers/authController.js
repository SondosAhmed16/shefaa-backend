const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require('fs');
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
    const {
      name, username, email, password, role, phoneNumber,
      commercialRegisterNumber,
      facilityType, medicalDirectorName, directorProfessionalId,
      addresses
    } = req.body;

    // 1. Auto hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 2. create user
    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      phoneNumber: phoneNumber,
      role: role || 'patient',
      isVerified: role === 'patient' ? true : false
    });
    const medicalLicenceUrl = req.file ? req.file.path : "";
    // 3. Create Profile based on role
    if (user.role === 'patient') {

      await Patient.create({
        userId: user._id,
      });
    } else if (user.role === 'doctor') {
      try {
        const pdfUrl = req.files && req.files['membership'] ? req.files['membership'][0].path : "";
        await Doctor.create({
          userId: user._id,
          specialization: req.body.specialization || "General",
          membershipPdf: pdfUrl,

        });
      } catch (error) {
        await User.findByIdAndDelete(user._id);
        return res.status(400).json({
          message: "Doctor profile creation failed, user deleted. Error: " + error.message
        });
      }
    }
    else if (user.role === 'pharmacy') {
      try {
        await Pharmacy.create({
          userId: user._id,
          commercialRegisterNumber: commercialRegisterNumber,
          medicalLicencePdf: medicalLicenceUrl,
          addresses: addresses || []
        });
      } catch (error) {
        await User.findByIdAndDelete(user._id);
        return res.status(400).json({
          message: "Pharmacy profile creation failed, user deleted. Error: " + error.message
        });
      }
    }
    else if (user.role === 'lab') {
      try {
        await Lab.create({
          userId: user._id,
          commercialRegisterNumber: commercialRegisterNumber,
          medicalLicencePdf: medicalLicenceUrl,
          facilityType,
          medicalDirectorName,
          directorProfessionalId,
          addresses: addresses || []
        });
      } catch (error) {
        await User.findByIdAndDelete(user._id);
        return res.status(400).json({
          message: "Lab profile creation failed, user deleted. Error: " + error.message
        });
      }
    }
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
    if (err.code === 11000) {
      return res.status(400).json({
        message: "Duplicate key error",
        field: err.keyValue
      });
    }
    res.status(500).json({ message: err.message });
  }
};
// Login 
exports.login = async (req, res) => {
  try {
    const { identity, password } = req.body;
    let user = null;

    user = await User.findOne({
      email: { $regex: new RegExp(`^${identity}$`, 'i') }
    });
    if (!user) {
      const patient = await Patient.findOne({ phoneNumber: identity });
      if (patient) {
        user = await User.findById(patient.userId);
      }
    }

    if (!user) {
      return res.status(401).json({
        message: "This email or phone number is not registered."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        message: "Incorrect password. Please try again."
      });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, role: user.role }
    });

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

    if (!resetEntry) {
      return res.status(400).json({ message: "The code you entered is incorrect." });
    }

    if (resetEntry.expiresAt < Date.now()) {
      return res.status(400).json({ message: "This code has expired. Please request a new one." });
    }
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

    // --- التعديل هنا: تشفير الباسورد الجديد قبل الحفظ ---
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    // حذف الكود بعد النجاح
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



