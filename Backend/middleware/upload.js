const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

// 1. إعدادات Cloudinary مباشرة جوه الملف
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. إعداد المخزن (Storage)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "shefaa_uploads", // اسم الفولدر اللي هيشيل كل حاجة
    resource_type: "auto",    // عشان يقبل PDF وصور
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
  },
});

// 3. إنشاء الـ Middleware
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // حد أقصى 10 ميجا للملف
});

module.exports = { upload, cloudinary };