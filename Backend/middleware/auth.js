const jwt = require("jsonwebtoken");
const User = require("../Models/Users"); // تأكد من المسار

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized: No token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // تعديل passwordHash لـ password
    const user = await User.findById(decoded.id).select("-password");
    
    if (!user || !user.isVerified) {
      return res.status(401).json({ message: "User not verified or not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(403).json({ message: "Invalid or expired token" });
  }
};

module.exports = { auth };