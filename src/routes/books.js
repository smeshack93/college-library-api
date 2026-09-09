// src/routes/bookRoutes.js
const express = require('express');
const router = express.Router();
const BookController = require('../controllers/bookController');
const { authMiddleware } = require('../middleware/auth');

// ==========================================
// Public Routes
// ==========================================
router.get('/', BookController.getAllBooks);

// ==========================================
// Protected Routes (Require Login)
// ==========================================

// Specific POST action endpoints
router.post('/request', authMiddleware, BookController.requestBook);
router.post('/return', authMiddleware, BookController.requestReturn);

// Authenticated user's personal history
router.get('/my-borrows', authMiddleware, BookController.getMyBorrows);

// Support both endpoint patterns for specific user borrows (:userId / :id)
router.get('/users/:userId/borrows', authMiddleware, BookController.getUserBorrows);
router.get('/user/:userId/borrows', authMiddleware, BookController.getUserBorrows);
router.get('/users/:id/borrows', authMiddleware, BookController.getUserBorrows);
router.get('/user/:id/borrows', authMiddleware, BookController.getUserBorrows);

// ==========================================
// Parameterized Catch-All Public Routes
// (MUST remain at the bottom to prevent route collisions)
// ==========================================
router.get('/:id', BookController.getBookById);

module.exports = router;
