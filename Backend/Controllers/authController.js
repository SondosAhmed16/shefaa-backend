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
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/tokens");

const { sendVerificationEmail } = require("../utils/sendEmail");
function parseDevice(req) {
  const ua = req.headers["user-agent"] || "";
  let device = "Unknown device";

  if (/iPhone|iPad/.test(ua)) device = "Safari · iPhone";
  else if (/Android/.test(ua)) device = "Chrome · Android";
  else if (/Macintosh/.test(ua)) device = "Safari · MacBook";
  else if (/Windows/.test(ua)) device = "Chrome · Windows";
  else if (/Linux/.test(ua)) device = "Browser · Linux";

  return device;
}

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
    const medicalLicenceUrl = req.files && req.files['medicalLicence'] ? req.files['medicalLicence'][0].path : "";
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

    let successMessage = "User registered successfully";

    if (user.role !== 'patient') {
      successMessage = "Registration successful! Your data is currently being reviewed by the administration. You will receive an email notification once your account is activated.";
    }

    res.status(201).json({
      message: successMessage,
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
      $or: [
        { email: { $regex: new RegExp(`^${identity}$`, 'i') } },
        { phoneNumber: identity }
      ]
    });

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
    if (!user.isVerified) {
      return res.status(403).json({
        message: "Your account is still pending review. You will be able to login once the administrator activates your account."
      });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deviceInfo: parseDevice(req),
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      location: "",   // optionally use an IP geolocation service later
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

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phoneNumber: user.phoneNumber,
        twoFA: user.twoFA ?? { enabled: false, method: "email" }, // ← add this
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.googleLoginMobile = async (req, res) => {
  const { idToken } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, sub: googleId } = payload;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: "Account not found. Please register first." });
    }

    if (!user.isVerified) {
      return res.status(403).json({ success: false, message: "Account pending review by admin." });
    }

    if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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
};



// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD  (authenticated – requires verifyToken middleware)
// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// ─────────────────────────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Both fields are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters." });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });

    // 1. Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    // 2. Prevent reuse
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json({ message: "New password must differ from the current one." });
    }

    // 3. Hash & save
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.passwordChangedAt = new Date();   // optional: track last change date
    await user.save();

    // 4. Invalidate all refresh tokens so other sessions are logged out
    await RefreshToken.deleteMany({ user: user._id });

    res.status(200).json({ message: "Password updated successfully. Please log in again." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TWO-FACTOR AUTHENTICATION
//
// The flow uses a 6-digit OTP stored (hashed) in the user document.
// Add these fields to your User schema:
//
//   twoFA: {
//     enabled:    { type: Boolean, default: false },
//     method:     { type: String, enum: ["sms","email"], default: "email" },
//     otpHash:    { type: String },
//     otpExpires: { type: Date },
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. ENABLE / DISABLE 2FA ──────────────────────────────────────────────────
// POST /api/auth/2fa/toggle
// Body: { enabled: true|false, method: "sms"|"email" }
exports.toggle2FA = async (req, res) => {
  try {
    const { enabled, method } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "'enabled' must be a boolean." });
    }
    if (enabled && !["sms", "email"].includes(method)) {
      return res.status(400).json({ message: "Method must be 'sms' or 'email'." });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });

    user.twoFA = { enabled, method: enabled ? method : user.twoFA?.method ?? "email" };
    await user.save();

    res.status(200).json({
      message: `Two-factor authentication ${enabled ? "enabled" : "disabled"}.`,
      twoFA: user.twoFA,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── 2. SEND OTP  (called right after password check in login) ────────────────
// POST /api/auth/2fa/send-otp
// Body: { userId }   ← pass the id returned from the first login step
exports.send2FAOTP = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user || !user.twoFA?.enabled) {
      return res.status(400).json({ message: "2FA is not enabled for this account." });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    user.twoFA.otpHash = otpHash;
    user.twoFA.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await user.save();

    if (user.twoFA.method === "email") {
      await sendVerificationEmail(user.email, otp);           // reuse your existing helper
    } else {
      // SMS: plug in Twilio / AWS SNS here
      // await sendSMS(user.phoneNumber, `Your verification code: ${otp}`);
      console.log(`[SMS stub] OTP for ${user.phoneNumber}: ${otp}`);
    }

    res.status(200).json({ message: "OTP sent.", method: user.twoFA.method });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── 3. VERIFY OTP  (final login step when 2FA is on) ────────────────────────
// POST /api/auth/2fa/verify-otp
// Body: { userId, otp }
exports.verify2FAOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) {
      return res.status(400).json({ message: "userId and otp are required." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const hashedInput = crypto.createHash("sha256").update(otp).digest("hex");

    if (
      !user.twoFA?.otpHash ||
      user.twoFA.otpHash !== hashedInput ||
      user.twoFA.otpExpires < new Date()
    ) {
      return res.status(401).json({ message: "Invalid or expired OTP." });
    }

    // Clear OTP
    user.twoFA.otpHash = undefined;
    user.twoFA.otpExpires = undefined;
    await user.save();

    // Issue tokens (same as normal login)
    const { generateAccessToken, generateRefreshToken } = require("../utils/tokens");
    const RefreshToken = require("../Models/RefreshToken");

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
      token: refreshToken,
      user: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.status(200).json({
      message: "Login successful.",
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/auth/sessions
exports.getSessions = async (req, res) => {
  try {
    const currentToken =
      req.headers.authorization?.split(" ")[1] || "";

    const sessions = await RefreshToken.find({
      user: req.user._id,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const result = sessions.map((s) => ({
      id:         s._id,
      deviceInfo: s.deviceInfo,
      ipAddress:  s.ipAddress,
      location:   s.location,
      createdAt:  s.createdAt,
      // mark current session by matching the access token's user+iat
      // simplest proxy: most recently created = current
      current: s._id.toString() ===
        sessions[0]._id.toString(), // first = most recent
    }));

    res.json({ sessions: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/auth/sessions/:id  — revoke one session
exports.revokeSession = async (req, res) => {
  try {
    const session = await RefreshToken.findOne({
      _id:  req.params.id,
      user: req.user._id,       // users can only revoke their own
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    await session.deleteOne();
    res.json({ message: "Session revoked." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/auth/sessions  — revoke all except current
exports.revokeAllSessions = async (req, res) => {
  try {
    // We need to know which token is "current" — pass it from frontend
    const { currentSessionId } = req.body;

    await RefreshToken.deleteMany({
      user: req.user._id,
      _id:  { $ne: currentSessionId },
    });

    res.json({ message: "All other sessions revoked." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};