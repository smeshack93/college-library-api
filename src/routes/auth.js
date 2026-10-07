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

// Login (Supports 'identifier', 'email', or 'username' dynamically for students, librarians, and admins)
router.post('/login', [
  body().custom((value, { req }) => {
    const identifier = req.body.identifier || req.body.email || req.body.username;
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      throw new Error('Email, username, or employee ID is required');
    }
    return true;
  }),
  body('password').notEmpty().withMessage('Password is required'),
  validateRequest
], AuthController.login);

// Register (Students only; supports both 'institution'/'college' and 'level'/'ntaLevel')
router.post('/register', [
  body('username').notEmpty().withMessage('Username is required').trim(),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('fullName').notEmpty().withMessage('Full name is required').trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('level').optional().trim(),
  body('ntaLevel').optional().trim(),
  body('phone').optional().trim(),
  body('institution').optional().trim(),
  body('college').optional().trim(),
  validateRequest
], AuthController.register);

// Forgot password — request reset link
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('role').optional().trim(),
  validateRequest
], AuthController.forgotPassword);

// Reset password — submit new password with token
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  validateRequest
], AuthController.resetPassword);

// Change password handler definition
const changePasswordValidation = [
  optionalAuthMiddleware,
  body('userId').optional().isInt({ min: 1 }).withMessage('Valid userId is required'),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  validateRequest
];

// Change password (POST & PUT supported for cross-compatibility)
router.post('/change-password', changePasswordValidation, AuthController.changePassword);
router.put('/change-password', changePasswordValidation, AuthController.changePassword);

module.exports = router;
