const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const AuthController = require('../controllers/authController');
const { optionalAuthMiddleware } = require('../middleware/auth');
const PasswordPolicy = require('../utils/passwordPolicy');

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

// express-validator custom validator for password strength.
// Uses the same logic as the Android PasswordValidator, keeping client and server aligned.
const passwordStrengthValidator = body('password').custom((value) => {
  if (!PasswordPolicy.isValid(value)) {
    throw new Error(PasswordPolicy.requirementShort());
  }
  return true;
});

const newPasswordStrengthValidator = body('newPassword').custom((value) => {
  if (!PasswordPolicy.isValid(value)) {
    throw new Error(PasswordPolicy.requirementShort());
  }
  return true;
});

// ---- Rate limiters ----
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

router.post('/register', registerLimiter, [
  body('username').notEmpty().withMessage('Username is required').trim(),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('fullName').notEmpty().withMessage('Full name is required').trim(),
  passwordStrengthValidator,          // server-side strength check
  body('level').optional().trim(),
  body('ntaLevel').optional().trim(),
  body('phone').optional().trim(),
  body('institution').optional().trim(),
  body('college').optional().trim(),
  validateRequest
], AuthController.register);

router.post('/forgot-password', forgotPasswordLimiter, [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('role').optional().trim(),
  validateRequest
], AuthController.forgotPassword);

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
  newPasswordStrengthValidator,       // server-side strength check
  validateRequest
], AuthController.resetPassword);

const changePasswordValidation = [
  optionalAuthMiddleware,
  body('userId').optional().isInt({ min: 1 }).withMessage('Valid userId is required'),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  newPasswordStrengthValidator,       // same check on change-password
  validateRequest
];

router.post('/change-password', changePasswordValidation, AuthController.changePassword);
router.put('/change-password', changePasswordValidation, AuthController.changePassword);

router.post('/logout', optionalAuthMiddleware, AuthController.logout);

module.exports = router;
