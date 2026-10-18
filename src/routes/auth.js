const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
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
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};

// ---- Rate limiters (NEW) ----
// Login: 20 attempts per IP per 15 minutes.
// A human rarely tries more than a few times; a brute-force script
// would be cut off long before guessing anything useful.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in a few minutes.'
  }
});

// Registration: 10 new accounts per IP per hour.
// Legitimate users register once. Bulk registration is abuse.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration attempts. Please try again later.'
  }
});

// Forgot password: 5 per IP per 15 minutes.
// Prevents email-bombing a victim's inbox from your Resend account.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again later.'
  }
});

// Reset password: 10 per IP per 15 minutes.
// Tighter than login because a valid token is required anyway.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset attempts. Please try again later.'
  }
});

// --- Authentication Routes ---

// Login
router.post('/login', loginLimiter, [
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

// Register
router.post('/register', registerLimiter, [
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

// Forgot password
router.post('/forgot-password', forgotPasswordLimiter, [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('role').optional().trim(),
  validateRequest
], AuthController.forgotPassword);

// Reset password
router.post('/reset-password', resetPasswordLimiter, [
  body().custom((value, { req }) => {
    const token = req.body.token;
    const employeeId = req.body.employeeId;
    if ((!token || String(token).trim() === '') &&
        (!employeeId || String(employeeId).trim() === '')) {
      throw new Error('Reset token or employeeId is required');
    }
    return true;
  }),
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

router.post('/change-password', changePasswordValidation, AuthController.changePassword);
router.put('/change-password', changePasswordValidation, AuthController.changePassword);

// ---- NEW: server-side logout endpoint ----
// Clears current_session_id for the requesting account so the JWT
// becomes unusable immediately, even though its expiry hasn't passed.
router.post('/logout', optionalAuthMiddleware, AuthController.logout);

module.exports = router;
