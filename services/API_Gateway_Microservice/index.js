const express = require('express');
const httpProxy = require('http-proxy');
const jwt = require('jsonwebtoken');
const fs = require('fs');
require('dotenv').config();
 
const app = express();
const proxy = httpProxy.createProxyServer();
 
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
 
const REGISTRATION_SERVICE_URL = process.env.REGISTRATION_SERVICE_URL;
const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL;
const LIBRARIAN_SERVICE_URL = process.env.LIBRARIAN_SERVICE_URL;
const MEMBER_SERVICE_URL = process.env.MEMBER_SERVICE_URL;


const LOG_FILE = process.env.LOG_FILE;
function writeLog(line) {
  console.log(line);
  if (!LOG_FILE) return;
  fs.appendFile(LOG_FILE, line + '\n', (err) => {
    if (err) console.error('Could not write log file:', err.message);
  });
}
 
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (!res.headersSent) {
    res.status(502).json({ message: 'The target microservice is not reachable. Is it running?' });
  }
});
 
// ---- 1) TOKEN CHECK: rejects no token, invalid token, expired token (401) ----
function authToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
 
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }
 
  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Access denied. Token has expired.' });
      }
      return res.status(401).json({ message: 'Access denied. Invalid token.' });
    }
    req.user = decoded;
    next();
  });
}
 
// ---- 2) ROLE CHECK: wrong role -> 403 ----
function authRole(requiredRole) {
  return (req, res, next) => {
    if (req.user.role !== requiredRole) {
      return res.status(403).json({
        message: `Access denied. This API is only for '${requiredRole}' accounts, not '${req.user.role}'.`,
      });
    }
    next();
  };
}
 
// ---- 3) FORWARD: stamp the secret + identity headers, then proxy ----
function forward(target) {
  return (req, res) => {
    req.url = req.originalUrl; // app.use() strips the prefix, put it back
 
    // never trust identity headers sent by the client
    delete req.headers['x-user-id'];
    delete req.headers['x-user-email'];
    delete req.headers['x-user-role'];
    delete req.headers['x-user-name'];
 
    req.headers['x-gateway-secret'] = GATEWAY_SECRET;
    if (req.user) {
      req.headers['x-user-id'] = String(req.user.id);
      req.headers['x-user-email'] = req.user.email;
      req.headers['x-user-role'] = req.user.role;
      req.headers['x-user-name'] = encodeURIComponent(req.user.name || '');
    }
    writeLog(`${new Date().toISOString()}  ${req.method} ${req.originalUrl}  [${req.user ? req.user.role : 'public'}] -> ${target}`);
    proxy.web(req, res, { target });
  };
}
 
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));
 
app.use('/register', forward(REGISTRATION_SERVICE_URL)); // public
app.use('/auth', forward(LOGIN_SERVICE_URL)); // public
app.use('/librarian', authToken, authRole('admin'), forward(LIBRARIAN_SERVICE_URL));
app.use('/member', authToken, authRole('member'), forward(MEMBER_SERVICE_URL));
 
app.use((req, res) => {
  res.status(404).json({ message: 'Unknown route. Please check the API path.' });
});
 
app.listen(PORT, () => {
  writeLog(`${new Date().toISOString()}  API Gateway started on port ${PORT}`);
  console.log(`🚪 API Gateway is running on port ${PORT}`);
  console.log('   /register  -> Registration Microservice (public)');
  console.log('   /auth      -> Login Microservice (public)');
  console.log('   /librarian -> Librarian Microservice (admin token required)');
  console.log('   /member    -> Member Microservice (member token required)');
});
