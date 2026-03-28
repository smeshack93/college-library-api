// routes/librarian.js
const express = require('express');
const router = express.Router();
const LibrarianController = require('../controllers/librarianController');
const { librarianAuth } = require('../middleware/auth');

/**
 * @route   POST /api/librarian/login
 * @desc    Librarian login & get token
 * @access  Public
 */
router.post('/login', LibrarianController.login);

/**
 * @route   POST /api/librarian/verify-identity
 * @desc    Verify librarian identity for password reset
 * @access  Public
 */
router.post('/verify-identity', LibrarianController.verifyIdentity);

/**
 * @route   POST /api/librarian/reset-password
 * @desc    Reset librarian password after verification
 * @access  Public
 */
router.post('/reset-password', LibrarianController.resetPassword);

/**
 * @route   GET /api/librarian/statistics
 * @desc    Get dashboard counts (Users, Books, Requests)
 * @access  Private (Librarian only)
 */
router.get('/statistics', librarianAuth, LibrarianController.getStatistics);

/**
 * @route   GET /api/librarian/requests/pending
 * @desc    Get list of all pending book requests
 * @access  Private (Librarian only)
 */
router.get('/requests/pending', librarianAuth, LibrarianController.getPendingRequests);

/**
 * @route   POST /api/librarian/requests/:id/approve
 * @desc    Approve a specific book request
 * @access  Private (Librarian only)
 */
router.post('/requests/:id/approve', librarianAuth, LibrarianController.approveRequest);

/**
 * @route   POST /api/librarian/requests/:id/reject
 * @desc    Reject a specific book request with notes
 * @access  Private (Librarian only)
 */
router.post('/requests/:id/reject', librarianAuth, LibrarianController.rejectRequest);

module.exports = router;