const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const AuthController = require('../controllers/authController');

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], AuthController.login);

// Register
router.post('/register', [
  body('username').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('fullName').notEmpty().trim(), // Matches req.body.fullName
  body('password').isLength({ min: 6 }),
  body('ntaLevel').notEmpty()        // Matches req.body.ntaLevel
], AuthController.register);

module.exports = router;