// src/routes/bookRoutes.js
const express = require('express');
const router = express.Router();
const BookController = require('../controllers/bookController');
const { authMiddleware } = require('../middleware/auth');

// Public routes
router.get('/', BookController.getAllBooks);
router.get('/:id', BookController.getBookById);

// Protected routes (require login)
router.post('/request', authMiddleware, BookController.requestBook);

// User borrow request history routes (supports both plural 'users' and singular 'user')
router.get('/users/:userId/borrows', authMiddleware, BookController.getUserBorrows);
router.get('/user/:userId/borrows', authMiddleware, BookController.getUserBorrows);

module.exports = router;
