const jwt = require('jsonwebtoken');

// Unified secret fallback
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

const authMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'No token, authorization denied' 
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token is not valid' 
    });
  }
};

const librarianAuth = (req, res, next) => {
  authMiddleware(req, res, () => {
    if (req.user?.type !== 'LIBRARIAN') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Librarian only.' 
      });
    }
    next();
  });
};

module.exports = { authMiddleware, librarianAuth };
