const helmet = require("helmet");
const hpp = require("hpp");

const securityMiddleware = (app) => {
  app.use(
    helmet({
      // عشان الفرونت إند على دومين تاني يقدر يعرض الصور والملفات من /uploads
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(hpp());
  // CORS بيتظبط في index.js بس (مكان واحد)
};

module.exports = securityMiddleware;