// ============================================================================
//  SEED-LIBRARIAN.JS  -  run ONCE:  node seed-librarian.js
// ============================================================================
//  Registration only creates members, so this script creates the first
//  librarian (role "admin") directly in MongoDB with a hashed password.
//  Change the values with LIBRARIAN_NAME / LIBRARIAN_EMAIL / LIBRARIAN_PASSWORD
//  in .env (or edit the defaults below).
// ============================================================================
 
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
require('dotenv').config();
 
const User = require('./models/User');
 
async function seed() {
  const name = process.env.LIBRARIAN_NAME || 'Head Librarian';
  const email = (process.env.LIBRARIAN_EMAIL || 'librarian@library.com').toLowerCase();
  const password = process.env.LIBRARIAN_PASSWORD || 'Librarian@123';
 
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB connected:', mongoose.connection.name);
 
  const exists = await User.findOne({ email });
  if (exists) {
    console.log('ℹ️  Librarian already exists:', email);
  } else {
    await User.create({ name, email, password: await bcrypt.hash(password, 10), role: 'admin', phone: '000000000' });
    console.log('✅ Librarian created:', email);
  }
  await mongoose.disconnect();
}
 
seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});

