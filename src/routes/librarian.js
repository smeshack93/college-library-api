const express = require('express');
const router = express.Router();
const LibrarianController = require('../controllers/librarianController');
const { librarianAuth } = require('../middleware/auth');

/**
 * @route   POST /api/librarian/login
 * @desc    Authenticate librarian & return JWT token
 * @access  Public
 */
router.post('/login', LibrarianController.login);

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
 * @route   POST /api/librarian/verify-identity
 * @desc    Verify librarian credentials for password recovery
 * @access  Public
 */
router.post('/verify-identity', LibrarianController.verifyIdentity);

/**
 * @route   POST /api/librarian/reset-password
 * @desc    Reset librarian password
 * @access  Public
 */
router.post('/reset-password', LibrarianController.resetPassword);

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

// --- Book Management (Scoped to Librarian's Institution) ---

/**
 * @route   POST /api/librarian/books
 * @desc    Upload/add a new book (scoped to librarian's institution)
 * @access  Private (Librarian only)
 */
router.post('/books', librarianAuth, LibrarianController.addBook);

/**
 * @route   GET /api/librarian/books
 * @desc    List all books belonging to librarian's institution
 * @access  Private (Librarian only)
 */
router.get('/books', librarianAuth, LibrarianController.listMyInstitutionBooks);

/**
 * @route   PUT /api/librarian/books/:id
 * @desc    Update a book belonging to librarian's institution
 * @access  Private (Librarian only)
 */
router.put('/books/:id', librarianAuth, LibrarianController.updateMyInstitutionBook);

/**
 * @route   DELETE /api/librarian/books/:id
 * @desc    Delete a book belonging to librarian's institution
 * @access  Private (Librarian only)
 */
router.delete('/books/:id', librarianAuth, LibrarianController.deleteMyInstitutionBook);

module.exports = router;
