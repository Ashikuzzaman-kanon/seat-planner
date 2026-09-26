const mongoose = require("mongoose");
const env = require("./env");

let connected = false;

/**
 * Connect to MongoDB if MONGO_URI is set. Intentionally NON-FATAL: if Mongo is
 * unavailable, the core MySQL-backed app keeps running and only the document
 * features (audit log / history / notifications) are disabled. This keeps the
 * two databases loosely coupled — a hallmark of polyglot persistence.
 */
async function connectMongo() {
  if (!env.mongo.uri) {
    console.warn(
      "[mongo] MONGO_URI not set — document features (audit log, history, notifications) are disabled."
    );
    return;
  }
  try {
    await mongoose.connect(env.mongo.uri, { serverSelectionTimeoutMS: 5000 });
    connected = true;
    console.log("✅ MongoDB connection established");
  } catch (err) {
    console.error(`[mongo] connection failed (document features disabled): ${err.message}`);
  }
}

/** True only when a live Mongo connection exists — guards document features. */
function isMongoConnected() {
  return connected && mongoose.connection.readyState === 1;
}

module.exports = { connectMongo, isMongoConnected, mongoose };
