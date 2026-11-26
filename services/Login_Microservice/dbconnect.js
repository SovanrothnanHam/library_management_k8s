// ============================================================
//  DBCONNECT.JS  -  "the phone call to MongoDB"
// ============================================================
// Connects this microservice to MongoDB Atlas using Mongoose.
// It prints a clear message so you can screenshot "connected".
// ============================================================
 
const mongoose = require('mongoose');
require('dotenv').config();
 
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await mongoose.connection.db.admin().command({ ping: 1 }); // say hello
    console.log('✅ MongoDB connected successfully:', mongoose.connection.name);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
  }
}
 
module.exports = connectDB;
