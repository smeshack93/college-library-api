const jwt = require('jsonwebtoken');

// Helper to extract and verify token
const verifyToken = (req, res) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return { error: { status: 401, message: 'No token, authorization denied' } };
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { decoded };
  } catch {
    return { error: { status: 401, message: 'Token is not valid' } };
  }
};

// General auth middleware
const authMiddleware = (req, res, next) => {
  const { decoded, error } = verifyToken(req, res);
  if (error) return res.status(error.status).json({ success: false, message: error.message });
  req.user = decoded;
  next();
};

// Role-based middleware
const roleAuth = (role) => (req, res, next) => {
  const { decoded, error } = verifyToken(req, res);
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  if (decoded.type !== role) {
    return res.status(403).json({ success: false, message: `Access denied. ${role} only.` });
  }
  req.user = decoded;
  next();
};

module.exports = { authMiddleware, roleAuth };
