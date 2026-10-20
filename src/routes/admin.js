const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const { adminAuth } = require('../middleware/auth');
const { pool } = require('../config/database');

router.use(adminAuth);

// Institution Branding Management
router.get('/institution-branding', async (req, res) => {
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
    console.error('Admin institution branding fetch error:', e);
    res.status(500).json({ success: false, message: 'Failed to load branding' });
  }
});

router.put('/institution-branding', async (req, res) => {
  try {
    const institution = req.user.institution;
    const { logo_image_url, banner_image_url } = req.body;
    
    if (!institution) {
      return res.status(400).json({ success: false, message: 'Institution context missing for admin' });
    }

    await pool.execute(
      `INSERT INTO institution_branding (institution_name, logo_image_url, banner_image_url)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       logo_image_url = COALESCE(?, logo_image_url), 
       banner_image_url = COALESCE(?, banner_image_url)`,
      [institution, logo_image_url, banner_image_url, logo_image_url, banner_image_url]
    );

    res.json({ success: true, message: 'Institution branding updated successfully' });
  } catch (e) {
    console.error('Admin institution branding update error:', e);
    res.status(500).json({ success: false, message: 'Failed to update branding' });
  }
});

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
