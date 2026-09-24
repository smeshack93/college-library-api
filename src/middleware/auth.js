const jwt = require('jsonwebtoken');

// Unified secret fallback
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * General Authentication Middleware
 * Validates JWT token and attaches user payload to req.user if present
 */
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
    req.user = decoded; // Contains id, email/username, type ('STUDENT' or 'LIBRARIAN')
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token is not valid' 
    });
  }
};

/**
 * Optional Authentication Middleware
 * Attaches req.user if a valid token is sent, but allows request to continue if no token is provided
 */
const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Token expired or invalid, continue without req.user
    }
  }
  next();
};

/**
 * Role-Specific Middleware for Librarians
 * Ensures user is authenticated and possesses the 'LIBRARIAN' role type
 */
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

module.exports = { authMiddleware, optionalAuthMiddleware, librarianAuth };
