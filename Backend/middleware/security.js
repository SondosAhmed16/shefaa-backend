const helmet = require("helmet");
const hpp = require("hpp");
const cors = require("cors");

const securityMiddleware = (app) => {
  app.use(helmet());
  app.use(hpp());
  
  app.use(cors({
    // سيقرأ رابط الفرونت إند من المتغيرات المحفوظة، وإذا لم يجدها سيسمح للكل
    origin: process.env.FRONTEND_URL || "*", 
    credentials: true // مهمة جداً لو الفرونت إند بيستخدم الـ Cookies أو الـ Headers الخاصة
  }));
};

module.exports = securityMiddleware;