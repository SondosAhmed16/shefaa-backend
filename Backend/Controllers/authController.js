const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require('fs'); // ضيفي دي فوق خالص مع الـ imports لو مش موجودة
const User = require('../Models/Users');
const Patient = require('../Models/Patients');
const Doctor = require('../Models/Doctors');
const Pharmacy = require('../Models/Pharmaces');

const RefreshToken = require("../Models/RefreshToken");
const PasswordReset = require("../Models/PasswordReset");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/tokens");

const { sendResetPasswordEmail } = require("../utils/sendEmail");



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
        phoneNumber: phoneNumber || "N/A",
        address: address || "N/A",
        age: age || 0,
        gender: gender || "male",
        height: req.body.height || 0,
        weight: req.body.weight || 0,
        bloodType: req.body.bloodType || "",
        allergies: req.body.allergies || []
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
// Login - يقبل الإيميل أو رقم التليفون
exports.login = async (req, res) => {
  try {
    const { identity, password } = req.body; // identity ممكن تكون إيميل أو تليفون

    // البحث في اليوزرز بالإيميل "أو" في بروفايل المريض برقم التليفون
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


// Forgot Password - البحث بالهوية
exports.forgotPassword = async (req, res) => {
  try {
    const { identity } = req.body;

    let user = await User.findOne({ email: identity });

    if (!user) {
      const patient = await Patient.findOne({ phoneNumber: identity });
      if (patient) {
        user = await User.findById(patient.userId);
      }
    }

    if (!user) return res.status(404).json({ message: "User not found" });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    await PasswordReset.create({
      user: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // لو معاه إيميل نبعت له، لو تليفون بس ممكن نرجع اللينك في الرد حالياً
    if (user.email) {
      await sendResetPasswordEmail(user.email, resetLink);
      res.json({ message: "Password reset link sent to your email" });
    } else {
      res.json({ message: "Reset link generated", resetLink }); // للتسهيل لو مفيش SMTP
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

//Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const resetDoc = await PasswordReset.findOne({ tokenHash });
    if (!resetDoc || resetDoc.expiresAt < new Date())
      return res.status(400).json({ message: "Invalid or expired token" });

    const user = await User.findById(resetDoc.user);
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    await PasswordReset.deleteOne({ _id: resetDoc._id });

    res.json({ message: "Password reset successfully" });
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



