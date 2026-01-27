// config/db.js
const mongoose = require("mongoose");
const logger = require("./loggerConfig");

const connectDB = async () => {
  try {
    mongoose.set("strictQuery", false);

    const conn = await mongoose.connect(process.env.MONGO_URI); // خلاص، من غير options

    logger.info(`📌 MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`❌ MongoDB Connection Error: ${error.message}`);
    logger.error("🔁 Retrying connection in 5 seconds...");
    setTimeout(connectDB, 5000);
  }
};

// Log mongoose connection events
mongoose.connection.on("connected", () => {
  logger.info("✅ Mongoose connected to database");
});

mongoose.connection.on("error", (err) => {
  logger.error(`❌ Mongoose error: ${err}`);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("⚠️ Mongoose disconnected");
});

// Close connection on server shutdown
process.on("SIGINT", async () => {
  await mongoose.connection.close();
  logger.info("🔻 Mongoose connection closed due to app termination");
  process.exit(0);
});

module.exports = connectDB;
