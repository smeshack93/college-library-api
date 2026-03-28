const express = require('express');
const router = express.Router();
const BookController = require('../controllers/bookController');
const { authMiddleware } = require('../middleware/auth');

// Public routes
router.get('/', BookController.getAllBooks);
router.get('/:id', BookController.getBookById);

// Protected routes (require login)
router.post('/request', authMiddleware, BookController.requestBook);

module.exports = router;