const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const { pool } = require('../config/database');

// ============================================================
// EXISTING — Android FCM token (unchanged, writes to fcm_token)
// ============================================================
router.post('/fcm-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });
    await User.updateFcmToken(req.user.id, token);
    res.json({ success: true });
  } catch (e) {
    console.error('User FCM token update error:', e);
    res.status(500).json({ success: false, message: 'Failed to update FCM token' });
  }
});

// ============================================================
// NEW — Web FCM token (writes to fcm_token_web).
// Android does not call this. Body shape is identical to the
// Android endpoint so future clients can share the same DTO.
// ============================================================
router.post('/fcm-token-web', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });
    await pool.execute(
      'UPDATE users SET fcm_token_web = ? WHERE id = ?',
      [String(token), req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('User Web FCM token update error:', e);
    res.status(500).json({ success: false, message: 'Failed to update web FCM token' });
  }
});

// ============================================================
// EXISTING — Institution branding (unchanged)
// ============================================================
router.get('/institution-branding', authMiddleware, async (req, res) => {
  try {
    const institution = req.user.institution || null;
    if (!institution) {
      return res.json({ success: true, data: null });
    }
    const [rows] = await pool.execute(
      `SELECT institution_name, logo_image_url, banner_image_url 
         FROM institution_branding WHERE institution_name = ? LIMIT 1`,
      [institution]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (e) {
    console.error('Institution branding fetch error:', e);
    res.status(500).json({ success: false, message: 'Failed to load branding' });
  }
});

module.exports = router;
