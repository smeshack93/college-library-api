const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const AuthController = require('../controllers/authController');
const { optionalAuthMiddleware } = require('../middleware/auth');

/**
 * Middleware to evaluate express-validator results
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg, // Returns the first error message
      errors: errors.array()
    });
  }
  next();
};

// --- Authentication Routes ---

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  validateRequest
], AuthController.login);

// Register
router.post('/register', [
  body('username').notEmpty().withMessage('Username is required').trim(),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('fullName').notEmpty().withMessage('Full name is required').trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('ntaLevel').notEmpty().withMessage('NTA Level is required'),
  validateRequest
], AuthController.register);

// Forgot password — request reset link
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  validateRequest
], AuthController.forgotPassword);

// Reset password — submit new password with token
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  validateRequest
], AuthController.resetPassword);

// Change password (student or librarian)
// Uses optionalAuthMiddleware so missing/expired tokens won't cause automatic 401 response
router.post('/change-password', [
  optionalAuthMiddleware,
  body('userId').optional().isInt({ min: 1 }).withMessage('Valid userId is required'),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  validateRequest
], AuthController.changePassword);

module.exports = router;
