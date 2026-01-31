const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require('../Models/Users');
const Patient = require('../Models/Patients'); 
const RefreshToken = require("../Models/RefreshToken");
const PasswordReset = require("../Models/PasswordReset");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/tokens");

const { sendResetPasswordEmail } = require("../utils/sendEmail");

// في ملف authController.js

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

    // 3. create patient profile
    if (user.role === 'patient') {
      await Patient.create({
        userId: user._id, 
        phoneNumber: phoneNumber || "N/A",
        address: address || "N/A",
        age: age || 0,
        gender: gender || "male"
      });
    }

    
    // auto login
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // 5.Refresh Token 
    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // صالح لمدة 7 أيام
    });

    // 6. response
    res.status(201).json({ 
      message: 'User and Patient profile created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      accessToken,
      refreshToken
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

//Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });

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


// Forget Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ message: "User not found" });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    await PasswordReset.create({
      user: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await sendResetPasswordEmail(email, resetLink);

    res.json({ message: "Password reset link sent" });
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



