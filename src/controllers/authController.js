const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Librarian = require('../models/Librarian');
const { pool } = require('../config/database');
const { sendResetEmail } = require('../config/email');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');

class AuthController {
  
  /**
   * Student Login
   * POST /api/auth/login
   */
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

      const isValid = verifyPassword(password, user.password);
      
      if (!isValid) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials' 
        });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, type: 'STUDENT' }, 
        process.env.JWT_SECRET || 'your-secret-key-change-this', 
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
          level: user.level || user.nta_level || '',
          nta_level: user.level || user.nta_level || '',
          phone: user.phone || '',
          college: user.college || ''
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

  /**
   * Student Registration
   * POST /api/auth/register
   */
  static async register(req, res) {
    try {
      const { username, email, fullName, password, level, ntaLevel, phone, college } = req.body;

      const userLevel = level || ntaLevel;

      if (!username || !email || !fullName || !password || !userLevel) {
        return res.status(400).json({ 
          success: false, 
          message: 'All required fields must be filled' 
        });
      }

      const allowedLevels = [
        'NTA Level 4', 'NTA Level 5', 'NTA Level 6', 
        'NVA', 'Secretarial', 'Degree', 'Masters', 'PhD', 'Others'
      ];
      
      if (!allowedLevels.includes(userLevel)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid Education Level' 
        });
      }

      if (password.length < 6) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 6 characters' 
        });
      }

      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email already registered' 
        });
      }

      const hashedPassword = hashPassword(password);

      const userId = await User.create({
        username,
        email,
        fullName,
        password: hashedPassword,
        level: userLevel,
        phone,
        college
      });

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
        message: 'Registration failed' 
      });
    }
  }

  /**
   * Request Forgot Password Email
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

      if (!user) {
        return res.json({ 
          success: true, 
          message: 'If that email exists, a reset link has been sent.' 
        });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await User.setResetToken(email, token, expiresAt);

      const baseUrl = process.env.APP_RESET_URL || 'collegelibrary://reset-password';
      const resetLink = `${baseUrl}?token=${token}&email=${encodeURIComponent(email)}`;

      try {
        await sendResetEmail(email, resetLink, user.full_name);
      } catch (mailErr) {
        console.error('Email send failed:', mailErr);
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
   * Reset Password via Token
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

      if (newPassword.length < 6) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 6 characters' 
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
   * Universal Change Password Endpoint (Handles both Students and Librarians)
   * POST /api/auth/change-password
   */
  static async changePassword(req, res) {
    try {
      const { userId, currentPassword, newPassword } = req.body;
      
      const activeUserId = req.user?.id || userId;
      const accountType = req.user?.type || req.body.userType || req.body.type;

      if (!activeUserId || !currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'userId, currentPassword, and newPassword are required'
        });
      }

      if (String(newPassword).length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters'
        });
      }

      let account = null;
      let isLibrarian = (accountType === 'LIBRARIAN');

      if (isLibrarian) {
        account = await Librarian.findByIdWithPassword(activeUserId);
      } else {
        account = await User.findByIdWithPassword(activeUserId);

        if (!account) {
          const libCheck = await Librarian.findByIdWithPassword(activeUserId);
          if (libCheck && verifyPassword(currentPassword, libCheck.password)) {
            account = libCheck;
            isLibrarian = true;
          }
        } else if (!verifyPassword(currentPassword, account.password)) {
          const libCheck = await Librarian.findByIdWithPassword(activeUserId);
          if (libCheck && verifyPassword(currentPassword, libCheck.password)) {
            account = libCheck;
            isLibrarian = true;
          }
        }
      }

      if (!account || account.is_active === 0 || account.is_active === false) {
        return res.status(404).json({
          success: false,
          message: 'Account not found or inactive'
        });
      }

      const isValid = verifyPassword(currentPassword, account.password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      const hashedPassword = hashPassword(newPassword);

      if (isLibrarian) {
        await Librarian.updatePassword(account.id, hashedPassword);
      } else {
        await User.updatePassword(account.id, hashedPassword);
      }

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

  /**
   * Update Student Profile
   * PUT /api/auth/profile
   * Requires authMiddleware (student JWT)
   */
  static async updateStudentProfile(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { username, email, fullName, phone, level } = req.body;

      if (!username && !email && !fullName && !phone && !level) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      // Uniqueness checks (exclude current user)
      if (email) {
        const [dup] = await pool.execute(
          'SELECT id FROM users WHERE email = ? AND id <> ? AND is_active = 1',
          [email, userId]
        );
        if (dup.length > 0) {
          return res.status(409).json({ success: false, message: 'Email already in use' });
        }
      }
      if (username) {
        const [dup] = await pool.execute(
          'SELECT id FROM users WHERE username = ? AND id <> ? AND is_active = 1',
          [username, userId]
        );
        if (dup.length > 0) {
          return res.status(409).json({ success: false, message: 'Username already in use' });
        }
      }

      const allowedLevels = [
        'NTA Level 4', 'NTA Level 5', 'NTA Level 6',
        'NVA', 'Secretarial', 'Degree', 'Masters', 'PhD', 'Others'
      ];
      if (level && !allowedLevels.includes(level)) {
        return res.status(400).json({ success: false, message: 'Invalid Education Level' });
      }

      const fields = [];
      const params = [];
      if (username) { fields.push('username = ?');  params.push(username); }
      if (email)    { fields.push('email = ?');     params.push(email); }
      if (fullName) { fields.push('full_name = ?'); params.push(fullName); }
      if (phone)    { fields.push('phone = ?');     params.push(phone); }
      if (level)    { fields.push('level = ?', 'nta_level = ?'); params.push(level, level); }

      params.push(userId);
      await pool.execute(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND is_active = 1`,
        params
      );

      const [rows] = await pool.execute(
        `SELECT id, username, email, full_name, level, phone, college
           FROM users WHERE id = ?`,
        [userId]
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const u = rows[0];
      return res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: u.id,
          username: u.username,
          email: u.email,
          full_name: u.full_name,
          fullName: u.full_name,
          level: u.level || '',
          nta_level: u.level || '',
          phone: u.phone || '',
          college: u.college || ''
        }
      });
    } catch (error) {
      console.error('Update student profile error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
  }
}

module.exports = AuthController;
