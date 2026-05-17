const jwt = require('jsonwebtoken');
const Sentry = require('@sentry/node');

module.exports = function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = decoded.id;
    Sentry.setUser({ id: String(decoded.id) });
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};
