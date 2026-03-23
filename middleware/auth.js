// middleware/auth.js — JWT authentication middleware
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_this';

function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, linkedinId: user.linkedin_id, name: user.name, avatarUrl: user.avatar_url },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = { requireAuth, createToken };
