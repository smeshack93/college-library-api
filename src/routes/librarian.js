const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const LibrarianController = require('../controllers/librarianController');
const { librarianAuth } = require('../middleware/auth');
const { pool } = require('../config/database');

// ---- Rate limiters (NEW) ----
const librarianLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in a few minutes.'
  }
});

const verifyIdentityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification attempts. Please try again later.'
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

/**
 * @route   POST /api/librarian/login
 * @desc    Authenticate librarian & return JWT token
 * @access  Public
 */
router.post('/login', librarianLoginLimiter, LibrarianController.login);

/**
 * @route   POST /api/librarian/fcm-token
 * @desc    Save/update librarian FCM device token
 * @access  Private (Librarian only)
 */
router.post('/fcm-token', librarianAuth, LibrarianController.updateFcmToken);

/**
 * @route   GET /api/librarian/profile
 * @desc    Get current logged in librarian profile info
 * @access  Private (Librarian only)
 */
router.get('/profile', librarianAuth, LibrarianController.getProfile);

/**
 * @route   PUT /api/librarian/profile
 * @desc    Update current librarian's profile info (username, email, phone)
 * @access  Private (Librarian only)
 */
router.put('/profile', librarianAuth, LibrarianController.updateProfile);

/**
 * @route   GET /api/librarian/institution-branding
 * @desc    Get current librarian's institution branding info
 * @access  Private (Librarian only)
 */
router.get('/institution-branding', librarianAuth, async (req, res) => {
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
    console.error('Librarian institution branding fetch error:', e);
    res.status(500).json({ success: false, message: 'Failed to load branding' });
  }
});

/**
 * @route   POST /api/librarian/verify-identity
 * @desc    Verify librarian credentials for password recovery
 * @access  Public
 */
router.post('/verify-identity', verifyIdentityLimiter, LibrarianController.verifyIdentity);

/**
 * @route   POST /api/librarian/reset-password
 * @desc    Reset librarian password
 * @access  Public
 */
router.post('/reset-password', resetPasswordLimiter, LibrarianController.resetPassword);

/**
 * @route   GET /api/librarian/requests/pending
 * @desc    Get all pending borrow/return requests
 * @access  Private (Librarian only)
 */
router.get('/requests/pending', librarianAuth, LibrarianController.getPendingRequests);

/**
 * @route   POST /api/librarian/requests/:id/approve
 * @desc    Approve a pending request
 * @access  Private (Librarian only)
 */
router.post('/requests/:id/approve', librarianAuth, LibrarianController.approveRequest);

/**
 * @route   POST /api/librarian/requests/:id/reject
 * @desc    Reject a pending request with reason
 * @access  Private (Librarian only)
 */
router.post('/requests/:id/reject', librarianAuth, LibrarianController.rejectRequest);

/**
 * @route   GET /api/librarian/statistics
 * @desc    Get library overview statistics
 * @access  Private (Librarian only)
 */
router.get('/statistics', librarianAuth, LibrarianController.getStatistics);

/**
 * @route   GET /api/librarian/requests/history
 * @desc    Get processed request history
 * @access  Private (Librarian only)
 */
router.get('/requests/history', librarianAuth, LibrarianController.getRequestHistory);

/**
 * @route   POST /api/librarian/requests/:id/remark
 * @desc    Add remark to request
 * @access  Private (Librarian only)
 */
router.post('/requests/:id/remark', librarianAuth, LibrarianController.addRequestRemark);

/**
 * @route   GET /api/librarian/analytics/trends
 * @desc    Get borrow trend data for charts
 * @access  Private (Librarian only)
 */
router.get('/analytics/trends', librarianAuth, LibrarianController.getBorrowTrends);

router.post('/books', librarianAuth, LibrarianController.addBook);
router.get('/books', librarianAuth, LibrarianController.listMyInstitutionBooks);
router.put('/books/:id', librarianAuth, LibrarianController.updateMyInstitutionBook);
router.delete('/books/:id', librarianAuth, LibrarianController.deleteMyInstitutionBook);

module.exports = router;
