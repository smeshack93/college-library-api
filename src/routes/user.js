const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');

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

module.exports = router;
