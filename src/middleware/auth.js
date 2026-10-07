const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

const authMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  if (!token) return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token is not valid or has expired' });
  }
};

const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { req.user = null; }
  }
  next();
};

const librarianAuth = (req, res, next) => {
  authMiddleware(req, res, () => {
    const role = (req.user?.type || req.user?.role || '').toUpperCase();
    if (role !== 'LIBRARIAN') {
      return res.status(403).json({ success: false, message: 'Access denied. Librarian only.' });
    }
    next();
  });
};

const adminAuth = (req, res, next) => {
  authMiddleware(req, res, () => {
    const role = (req.user?.type || req.user?.role || '').toUpperCase();
    if (role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
    }
    next();
  });
};

module.exports = { authMiddleware, optionalAuthMiddleware, librarianAuth, adminAuth };
