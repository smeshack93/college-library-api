const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendResetEmail } = require('../config/email');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');

class AuthController {
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email and password required' 
        });
      }
      
      const user = await User.findByEmail(email);
      
      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials' 
        });
      }

      // Use the unified password verification
      const isValid = verifyPassword(password, user.password);
      
      if (!isValid) {
        console.log(`❌ Auth failed for user: ${email}`);
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials' 
        });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, type: 'STUDENT' }, 
        process.env.JWT_SECRET, 
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        token,
        user: { 
          id: user.id, 
          username: user.username, 
          email: user.email,
          full_name: user.full_name,
          nta_level: user.nta_level
        }
      });
      
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error' 
      });
    }
  }

  static async register(req, res) {
    try {
      const { username, email, fullName, password, ntaLevel } = req.body;

      // Validate required fields
      if (!username || !email || !fullName || !password || !ntaLevel) {
        return res.status(400).json({ 
          success: false, 
          message: 'All fields are required' 
        });
      }

      // Validate NTA Level Enum
      const allowedLevels = ['NTA Level 4', 'NTA Level 5', 'NTA Level 6', 'NVA', 'Secretarial'];
      if (!allowedLevels.includes(ntaLevel)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid NTA Level' 
        });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 8 characters' 
        });
      }

      // Check if user exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email already registered' 
        });
      }

      // Hash password using PBKDF2 (matching Java format)
      const hashedPassword = hashPassword(password);

      // Create user
      const userId = await User.create({
        username,
        email,
        fullName,
        password: hashedPassword,
        ntaLevel
      });

      console.log(`✅ User registered: ${username} (ID: ${userId})`);

      res.status(201).json({ 
        success: true, 
        message: 'User registered successfully',
        userId 
      });
      
    } catch (error) {
      console.error('Registration Error:', error);
      
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ 
          success: false, 
          message: 'Username or email already exists' 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Registration failed' 
      });
    }
  }

  /**
   * Request password reset — sends email with token link
   * POST /api/auth/forgot-password
   */
  static async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email is required' 
        });
      }

      const user = await User.findByEmail(email);

      // Always return success response to prevent email enumeration
      if (!user) {
        return res.json({ 
          success: true, 
          message: 'If that email exists, a reset link has been sent.' 
        });
      }

      // Generate cryptographically secure random token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes validity

      await User.setResetToken(email, token, expiresAt);

      // Build deep-link or web reset link
      const baseUrl = process.env.APP_RESET_URL || 'collegelibrary://reset-password';
      const resetLink = `${baseUrl}?token=${token}&email=${encodeURIComponent(email)}`;

      try {
        await sendResetEmail(email, resetLink, user.full_name);
        console.log(`📧 Reset email sent to: ${email}`);
      } catch (mailErr) {
        console.error('Email send failed:', mailErr);
        // Do not leak email sending failures directly to end user
      }

      res.json({ 
        success: true, 
        message: 'If that email exists, a reset link has been sent.' 
      });

    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error' 
      });
    }
  }

  /**
   * Reset password using token
   * POST /api/auth/reset-password
   */
  static async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ 
          success: false, 
          message: 'Token and new password are required' 
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 8 characters' 
        });
      }

      const user = await User.findByResetToken(token);

      if (!user) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid or expired reset token' 
        });
      }

      const hashedPassword = hashPassword(newPassword);
      await User.updatePassword(user.id, hashedPassword);
      await User.clearResetToken(user.id);

      console.log(`✅ Password reset for user: ${user.email}`);

      res.json({ 
        success: true, 
        message: 'Password reset successfully. You can now login.' 
      });

    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error' 
      });
    }
  }

  /**
   * Change password for the logged-in user.
   * POST /api/auth/change-password
   * Body: { userId, currentPassword, newPassword }
   * Works for both students and librarians (same `users` table).
   */
  static async changePassword(req, res) {
    try {
      const { userId, currentPassword, newPassword } = req.body;

      if (!userId || !currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'userId, currentPassword and newPassword are required'
        });
      }

      if (String(newPassword).length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters'
        });
      }

      // Look up user using User model (avoids requiring database connection directly)
      const user = await User.findById(userId);

      if (!user || user.is_active === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify current password
      const isValid = verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash and store the new password
      const hashedPassword = hashPassword(newPassword);
      await User.updatePassword(user.id, hashedPassword);

      console.log(`✅ Password changed for user id: ${user.id}`);

      return res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
}

module.exports = AuthController;
