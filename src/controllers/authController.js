const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Librarian = require('../models/Librarian');
const { sendResetEmail } = require('../config/email');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');
const LoginLockout = require('../utils/loginLockout');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

class AuthController {

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

      // ============================================================
      // NEW STEP 0 — Determine whether the identifier exists at all
      // and whether the matching row is active. This runs BEFORE the
      // current flow so we can surface distinct messages:
      //   - account does not exist  -> 404 ACCOUNT_NOT_FOUND
      //   - account is deactivated  -> 403 ACCOUNT_DEACTIVATED
      // Existing happy-path logic below is untouched.
      // ============================================================
      const identity = await AuthController._resolveIdentity(identifier);
      if (identity.state === 'MISSING') {
        return res.status(404).json({
          success: false,
          code: 'ACCOUNT_NOT_FOUND',
          message: 'Account does not exist. Please register to create a new account.'
        });
      }
      if (identity.state === 'INACTIVE') {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated. Please contact the system administrator for assistance.'
        });
      }

      // 1. Try users table (STUDENT or ADMIN)
      let user = await User.findByEmail(identifier);
      if (!user) user = await User.findByUsername(identifier);

      if (user) {
        // NEW: account-level lockout check
        const lock = await LoginLockout.checkLocked('users', user.id);
        if (lock.locked) {
          return res.status(423).json({
            success: false,
            message: `Account is temporarily locked due to repeated failed login attempts. Try again after ${new Date(lock.until).toLocaleTimeString()}.`
          });
        }

        if (!verifyPassword(password, user.password)) {
          // NEW: register the failure (may set the lock)
          await LoginLockout.registerFailure('users', user.id);
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // NEW: successful login clears any prior failure counter.
        await LoginLockout.clearLock('users', user.id);

        const role = (user.role || 'STUDENT').toUpperCase();
        const sid = newSessionId();
        await User.setCurrentSession(user.id, sid);

        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            username: user.username,
            role,
            type: role,
            institution: user.institution || user.college || null,
            sid
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
        // NEW: lockout check
        const lock = await LoginLockout.checkLocked('librarians', librarian.id);
        if (lock.locked) {
          return res.status(423).json({
            success: false,
            message: `Account is temporarily locked due to repeated failed login attempts. Try again after ${new Date(lock.until).toLocaleTimeString()}.`
          });
        }

        const stored = librarian.password;
        let ok = false;
        if (stored && stored.startsWith('PBKDF2:')) {
          ok = verifyPassword(password, stored);
        } else {
          ok = verifyPassword(password, stored);
        }
        if (!ok) {
          // NEW: register the failure
          await LoginLockout.registerFailure('librarians', librarian.id);
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // NEW: successful login clears any prior failure counter.
        await LoginLockout.clearLock('librarians', librarian.id);

        const sid = newSessionId();
        await Librarian.setCurrentSession(librarian.id, sid);

        const token = jwt.sign(
          {
            id: librarian.id,
            username: librarian.username,
            employeeId: librarian.employee_id,
            type: 'LIBRARIAN',
            role: 'LIBRARIAN',
            institution: librarian.institution || null,
            sid
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

  // ==============================================================
  // NEW HELPER — determine whether an identifier belongs to any
  // account (user or librarian), ignoring the is_active filter, so
  // the controller can return a distinct message for "missing"
  // vs "deactivated".
  //
  // Returns:
  //   { state: 'ACTIVE'   }  -> continue with the normal login flow
  //   { state: 'INACTIVE' }  -> respond 403 ACCOUNT_DEACTIVATED
  //   { state: 'MISSING'  }  -> respond 404 ACCOUNT_NOT_FOUND
  // ==============================================================
  static async _resolveIdentity(identifier) {
    const [userRows] = await pool.execute(
      `SELECT id, is_active FROM users
        WHERE email = ? OR username = ? LIMIT 1`,
      [identifier, identifier]
    );
    if (userRows.length > 0) {
      return userRows[0].is_active ? { state: 'ACTIVE' } : { state: 'INACTIVE' };
    }

    const [libRows] = await pool.execute(
      `SELECT id, is_active FROM librarians
        WHERE username = ? OR email = ? OR employee_id = ? LIMIT 1`,
      [identifier, identifier, identifier]
    );
    if (libRows.length > 0) {
      return libRows[0].is_active ? { state: 'ACTIVE' } : { state: 'INACTIVE' };
    }

    return { state: 'MISSING' };
  }

  static async register(req, res) {
    try {
      const { username, email, fullName, password, level, ntaLevel, phone, college, institution } = req.body;

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

      // ============================================================
      // NEW STEP 1 — Full duplicate check across username / email /
      // phone for users (regardless of is_active) AND against
      // librarians' email/username. If any field collides, return a
      // single friendly message instructing the user to contact the
      // system administrator.
      //
      // This runs BEFORE the existing User.findByEmail check so the
      // latter never masks a deactivated-account collision.
      // ============================================================
      const duplicate = await AuthController._findDuplicateRegistrationField({
        username,
        email,
        phone
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_REGISTRATION',
          field: duplicate,
          message: 'An account with these details already exists. ' +
                   'Please contact the system administrator for assistance.'
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

  // ==============================================================
  // NEW HELPER — return the name of the first colliding field
  // ('username' | 'email' | 'phone' | 'librarian') or null when all
  // are free. Ignores is_active, so a deactivated account still
  // blocks re-registration with the same details — the user is
  // directed to the admin instead of silently duplicating rows.
  // ==============================================================
  static async _findDuplicateRegistrationField({ username, email, phone }) {
    // 1) users table
    const [userRows] = await pool.execute(
      `SELECT username, email, phone FROM users
        WHERE username = ? OR email = ? OR (phone IS NOT NULL AND phone = ?)
        LIMIT 1`,
      [username, email, phone || null]
    );
    if (userRows.length > 0) {
      const row = userRows[0];
      if (row.username === username) return 'username';
      if (row.email === email) return 'email';
      if (phone && row.phone === phone) return 'phone';
    }

    // 2) librarians table — protect against email/username reuse
    const [libRows] = await pool.execute(
      `SELECT username, email FROM librarians
        WHERE username = ? OR email = ? LIMIT 1`,
      [username, email]
    );
    if (libRows.length > 0) {
      const row = libRows[0];
      if (row.username === username) return 'username';
      if (row.email === email) return 'email';
    }

    return null;
  }

  static async forgotPassword(req, res) {
    try {
      const { email, role } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      if ((role || '').toUpperCase() === 'LIBRARIAN') {
        return res.json({
          success: true,
          message: 'Please use the Librarian Password Recovery screen to verify your identity.'
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

  static async resetPassword(req, res) {
    try {
      const { token, employeeId, newPassword } = req.body;

      if ((!token || String(token).trim() === '') && employeeId) {
        if (!newPassword || String(newPassword).length < 8) {
          return res.status(400).json({
            success: false,
            message: 'New password must be at least 8 characters'
          });
        }

        const lib = await Librarian.findByUsernameOrEmailOrEmployee(employeeId);
        if (!lib) {
          return res.status(404).json({
            success: false,
            message: 'Account non-existent or inactive.'
          });
        }

        const hashed = hashPassword(newPassword);
        const ok = await Librarian.updatePassword(lib.id, hashed);
        if (!ok) {
          return res.status(500).json({
            success: false,
            message: 'Failed to reset password.'
          });
        }

        await Librarian.clearCurrentSession(lib.id);

        return res.json({
          success: true,
          message: 'Password reset successfully.'
        });
      }

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
      await User.clearCurrentSession(user.id);

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
        await Librarian.clearCurrentSession(account.id);
      } else {
        await User.updatePassword(account.id, hashedPassword);
        await User.clearCurrentSession(account.id);
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

  // ---------------------------------------------------------------
  // NEW: Update the currently logged-in STUDENT or ADMIN profile.
  // PUT /api/auth/profile
  // Body: { username?, email?, fullName?, phone?, level? }
  // ---------------------------------------------------------------
  static async updateProfile(req, res) {
    try {
      const userId = req.user && req.user.id;
      const accountType = String(
        (req.user && (req.user.type || req.user.role)) || 'STUDENT'
      ).toUpperCase();

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
      }
      if (accountType === 'LIBRARIAN') {
        return res.status(403).json({
          success: false,
          message: 'Use PUT /api/librarian/profile for librarian accounts'
        });
      }

      const { username, email, fullName, phone, level } = req.body || {};

      // Validate level against the same whitelist used by register().
      let normalizedLevel = undefined;
      if (level !== undefined && level !== null && String(level).trim() !== '') {
        const allowedLevels = [
          'NTA Level 4', 'NTA Level 5', 'NTA Level 6',
          'NVA', 'Secretarial', 'Degree', 'Masters', 'PhD', 'Others'
        ];
        if (!allowedLevels.includes(String(level))) {
          return res.status(400).json({ success: false, message: 'Invalid Education Level' });
        }
        normalizedLevel = String(level);
      }

      let ok = false;
      try {
        ok = await User.updateProfile(userId, {
          username,
          email,
          fullName,
          phone,
          level: normalizedLevel
        });
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({
            success: false,
            message: 'Username or email already in use'
          });
        }
        throw e;
      }

      if (!ok) {
        return res.status(400).json({ success: false, message: 'No changes to save' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      return res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          level: user.level || '',
          phone: user.phone || '',
          institution: user.institution || '',
          college: user.institution || '',
          role: (user.role || 'STUDENT').toUpperCase()
        }
      });
    } catch (error) {
      console.error('updateProfile error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
  }

  static async logout(req, res) {
    try {
      const payload = req.user;
      if (!payload || !payload.id) {
        return res.json({ success: true, message: 'Logged out.' });
      }

      const role = String(payload.type || payload.role || '').toUpperCase();

      if (role === 'LIBRARIAN') {
        await Librarian.clearCurrentSession(payload.id);
      } else {
        await User.clearCurrentSession(payload.id);
      }

      return res.json({ success: true, message: 'Logged out.' });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to log out.'
      });
    }
  }
}

module.exports = AuthController;
