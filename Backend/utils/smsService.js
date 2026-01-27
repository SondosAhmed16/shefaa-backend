const twilio = require('twilio'); // npm install twilio

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

exports.sendSMS = async (phoneNumber, message) => {
  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE,
      to: phoneNumber,
    });
    return true;
  } catch (err) {
    console.error('SMS Error:', err.message);
    return false;
  }
};