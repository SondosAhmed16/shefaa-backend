const nodemailer = require("nodemailer");
const logger = require("./loggerConfig");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// test transporter works
transporter.verify((error, success) => {
  if (error) {
    logger.error("❌ Mail Transporter Error: " + error.message);
  } else {
    logger.info("📨 Mailer is ready to send emails");
  }
});

const sendMail = async (to, subject, html) => {
  try {
    await transporter.sendMail({
      from: `"Online Clinic" <${process.env.MAIL_USER}>`,
      to,
      subject,
      html,
    });

    logger.info(`📧 Email sent to: ${to}`);
    return true;
  } catch (err) {
    logger.error("❌ Mailer error: " + err.message);
    return false;
  }
};

module.exports = { sendMail };
