const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const { adminAuth } = require('../middleware/auth');

router.use(adminAuth);

// Librarians
router.get('/librarians', AdminController.listLibrarians);
router.post('/librarians', AdminController.createLibrarian);
router.patch('/librarians/:id/active', AdminController.setLibrarianActive);
router.delete('/librarians/:id', AdminController.deleteLibrarian);

// Users
router.get('/users', AdminController.listUsers);
router.patch('/users/:id/active', AdminController.setUserActive);
router.delete('/users/:id', AdminController.deleteUser);

// Books
router.get('/books', AdminController.listBooks);
router.post('/books', AdminController.createBook);
router.put('/books/:id', AdminController.updateBook);
router.delete('/books/:id', AdminController.deleteBook);

// Stats
router.get('/stats', AdminController.getStats);

module.exports = router;
