// التعديل في السطر الأول
const { sendMail } = require('../config/mailer'); 

exports.sendVerificationEmail = async (userEmail, code) => {
  const html = `
    <h2>Verify Your Email</h2>
    <p>Use this code to verify your account:</p>
    <h3>${code}</h3>
  `;
  return await sendMail(userEmail, 'Email Verification', html);
};

exports.sendResetPasswordEmail = async (userEmail, link) => {
  const html = `
    <h2>Password Reset</h2>
    <p>Click the link below to reset your password:</p>
    <a href="${link}">Reset Password</a>
  `;
  return await sendMail(userEmail, 'Reset Password', html);
};