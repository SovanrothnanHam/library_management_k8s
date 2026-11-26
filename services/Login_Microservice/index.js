// ============================================================================
//  LOGIN MICROSERVICE  -  the "ID card printing desk"  (port 3002)
// ============================================================================
//  Checks email + password + role against MongoDB. If all match, it returns a
//  JWT that contains id, email, name and role.
// ============================================================================
 
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
 
const connectDB = require('./dbconnect');
const User = require('./models/User');
 
const app = express();
app.use(express.json());
 
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1h';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
 
connectDB();
 
// SECURITY GATE: block direct access
app.use((req, res, next) => {
  if (req.headers['x-gateway-secret'] !== GATEWAY_SECRET) {
    return res.status(403).json({ message: 'Direct access blocked. Please call this API through the API Gateway.' });
  }
  console.log(`${new Date().toISOString()}  ${req.method} ${req.originalUrl}`); // shows up in docker logs
  next();
});
 
// POST /auth/login   body: { "email": "...", "password": "...", "role": "admin" | "member" }
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body || {};
 
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'email, password and role are all required.' });
    }
    if (role !== 'admin' && role !== 'member') {
      return res.status(400).json({ message: "role must be exactly 'admin' or 'member'." });
    }
 
    // 1) find the account
    const account = await User.findOne({ email: String(email).toLowerCase() });
    if (!account) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
 
    // 2) compare password with the stored hash
    const passwordMatches = await bcrypt.compare(password, account.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
 
    // 3) the role they claim must be the role they own
    if (account.role !== role) {
      return res.status(401).json({ message: 'Invalid email, password, or role.' });
    }
 
    // 4) everything matches -> create the JWT
    const token = jwt.sign(
      { id: account._id, email: account.email, role: account.role, name: account.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );
 
    return res.status(200).json({ message: 'Login successful!', token, role: account.role, expiresIn: JWT_EXPIRES });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Something went wrong during login.', error: err.message });
  }
});
 
app.listen(PORT, () => {
  console.log(`🔑 Login Microservice running on port ${PORT}`);
});
