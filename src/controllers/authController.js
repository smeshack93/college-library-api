const User = require('../models/User');
const jwt = require('jsonwebtoken');
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
}

module.exports = AuthController;