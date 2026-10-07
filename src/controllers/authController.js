const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Librarian = require('../models/Librarian');
const { sendResetEmail } = require('../config/email');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

class AuthController {

  /**
   * Unified login for STUDENT / LIBRARIAN / ADMIN.
   * POST /api/auth/login
   * Body: { identifier, password } OR { email, password }
   */
  static async login(req, res) {
    try {
      const identifier = (req.body.identifier || req.body.email || req.body.username || '').trim();
      const { password } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({ 
          success: false, 
          message: 'Identifier and password required' 
        });
      }

      // 1. Try users table (STUDENT or ADMIN)
      let user = await User.findByEmail(identifier);
      if (!user) user = await User.findByUsername(identifier);

      if (user) {
        if (!verifyPassword(password, user.password)) {
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const role = (user.role || 'STUDENT').toUpperCase();
        const token = jwt.sign(
          { 
            id: user.id, 
            email: user.email, 
            username: user.username,
            role, 
            type: role, 
            institution: user.institution || user.college || null 
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        return res.json({
          success: true,
          token,
          role,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            level: user.level || user.nta_level || '',
            nta_level: user.level || user.nta_level || '',
            phone: user.phone || '',
            institution: user.institution || user.college || '',
            college: user.institution || user.college || '',
            role
          }
        });
      }

      // 2. Try librarians table
      const librarian = await Librarian.findByUsernameOrEmailOrEmployee(identifier);
      if (librarian) {
        const stored = librarian.password;
        let ok = false;
        if (stored && stored.startsWith('PBKDF2:')) {
          ok = verifyPassword(password, stored);
        } else {
          ok = verifyPassword(password, stored);
        }
        if (!ok) {
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const token = jwt.sign(
          { 
            id: librarian.id, 
            username: librarian.username,
            employeeId: librarian.employee_id, 
            type: 'LIBRARIAN',
            role: 'LIBRARIAN', 
            institution: librarian.institution || null 
          },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        return res.json({
          success: true,
          token,
          role: 'LIBRARIAN',
          user: {
            id: librarian.id,
            username: librarian.username,
            email: librarian.email,
            fullName: librarian.full_name,
            employeeId: librarian.employee_id,
            phone: librarian.phone || '',
            institution: librarian.institution || '',
            role: 'LIBRARIAN',
            forcePasswordChange: !!librarian.force_password_change
          }
        });
      }

      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (e) {
      console.error('Unified login error:', e);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  /**
   * Student Registration
   * POST /api/auth/register
   */
  static async register(req, res) {
    try {
      const { username, email, fullName, password, level, ntaLevel, phone, college, institution } = req.body;

      // Support both 'level' and 'ntaLevel' keys seamlessly
      const userLevel = level || ntaLevel;
      const userInstitution = institution || college;

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

      if (password.length < 8) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 8 characters' 
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
        college: userInstitution,
        institution: userInstitution,
        role: 'STUDENT'
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
      const { email, role } = req.body;

      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email is required' 
        });
      }

      // Librarian path (manual reset via identity verification)
      if ((role || '').toUpperCase() === 'LIBRARIAN') {
        return res.json({
          success: true,
          message: 'Please use the Librarian Password Recovery screen to verify your identity.'
        });
      }

      const user = await User.findByEmail(email);

      if (!user) {
        // Do not leak user existence
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
          message: 'Token and new password required' 
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

      res.json({ 
        success: true, 
        message: 'Password reset successfully.' 
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
      const accountType = (req.user?.type || req.body.userType || req.body.type || '').toUpperCase();

      if (!activeUserId || !currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'userId, currentPassword, newPassword required'
        });
      }

      if (String(newPassword).length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters'
        });
      }

      let account = null;
      let isLibrarian = (accountType === 'LIBRARIAN');

      if (isLibrarian) {
        account = await Librarian.findByIdWithPassword(activeUserId);
      } else {
        account = await User.findByIdWithPassword(activeUserId);

        if (!account || !verifyPassword(currentPassword, account.password)) {
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

      if (!verifyPassword(currentPassword, account.password)) {
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
}

module.exports = AuthController;
