// ============================================================================
//  REGISTRATION MICROSERVICE  -  the "sign-up desk"  (port 3001)
// ============================================================================
//  Only job: create new MEMBER accounts.
//  Flow: gateway check -> validate -> unique email -> hash password -> save
//  The librarian (admin) account is NOT created here. It is created once
//  with:  node seed-librarian.js
// ============================================================================
 
const express = require('express');
const bcrypt = require('bcryptjs');
require('dotenv').config();
 
const connectDB = require('./dbconnect');
const User = require('./models/User');
 
const app = express();
app.use(express.json());
 
const PORT = process.env.PORT || 3001;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
 
connectDB();
 
// SECURITY GATE: block anyone who did not come through the API Gateway
app.use((req, res, next) => {
  if (req.headers['x-gateway-secret'] !== GATEWAY_SECRET) {
    return res.status(403).json({ message: 'Direct access blocked. Please call this API through the API Gateway.' });
  }
  console.log(`${new Date().toISOString()}  ${req.method} ${req.originalUrl}`); // shows up in docker logs
  next();
});
 
// POST /register/userregister
app.post('/register/userregister', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};
 
    // 1) Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }
 
    // 2) Email must be unique
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: 'This email is already registered. Please login instead.' });
    }
 
    // 3) Hash the password (never store plain text)
    const hashedPassword = await bcrypt.hash(password, 10);
 
    // 4) Save. The role is ALWAYS "member", whatever the client sends.
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone,
      role: 'member',
    });
 
    // 5) Never send the password back
    return res.status(201).json({
      message: 'Registration successful!',
      user: { id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role, phone: newUser.phone },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Something went wrong during registration.', error: err.message });
  }
});
 
app.listen(PORT, () => {
  console.log(`📝 Registration Microservice running on port ${PORT}`);
});
