const User = require('../models/User');
const Librarian = require('../models/Librarian');
const Book = require('../models/Book');
const { hashPassword } = require('../utils/passwordUtils');
const { pool } = require('../config/database');

class AdminController {

  // ============== LIBRARIANS ==============

  static async listLibrarians(req, res) {
    try {
      const list = await Librarian.listAll({
        institution: req.query.institution || null,
        search: req.query.search || null
      });
      res.json({ success: true, count: list.length, data: list });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Failed to list librarians' });
    }
  }

  static async createLibrarian(req, res) {
    try {
      const { username, password, email, phone, fullName, employeeId, institution } = req.body;
      if (!username || !password || !email || !fullName || !employeeId) {
        return res.status(400).json({ success: false, message: 'username, password, email, fullName, employeeId required' });
      }
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      }
      const hash = hashPassword(password);
      const id = await Librarian.create({
        username, password: hash, email, phone: phone || null,
        fullName, employeeId, institution: institution || null
      });
      res.status(201).json({ success: true, message: 'Librarian created', librarianId: id });
    } catch (e) {
      console.error(e);
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'Username/email/employee ID already exists' });
      }
      res.status(500).json({ success: false, message: 'Failed to create librarian' });
    }
  }

  static async setLibrarianActive(req, res) {
    try {
      const ok = await Librarian.setActive(req.params.id, !!req.body.active);
      if (!ok) return res.status(404).json({ success: false, message: 'Librarian not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to update librarian' });
    }
  }

  static async deleteLibrarian(req, res) {
    try {
      const ok = await Librarian.deleteById(req.params.id);
      if (!ok) return res.status(404).json({ success: false, message: 'Librarian not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to delete librarian' });
    }
  }

  // ============== USERS ==============

  static async listUsers(req, res) {
    try {
      const list = await User.listAll({
        role: req.query.role || null,
        institution: req.query.institution || null,
        search: req.query.search || null
      });
      res.json({ success: true, count: list.length, data: list });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to list users' });
    }
  }

  static async setUserActive(req, res) {
    try {
      const [[targetUser]] = await pool.execute('SELECT role FROM users WHERE id = ?', [req.params.id]);
      if (targetUser && targetUser.role === 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin accounts cannot be deactivated.' });
      }

      const ok = await User.setActive(req.params.id, !!req.body.active);
      if (!ok) return res.status(404).json({ success: false, message: 'User not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to update user' });
    }
  }

  static async deleteUser(req, res) {
    try {
      const [[targetUser]] = await pool.execute('SELECT role FROM users WHERE id = ?', [req.params.id]);
      if (targetUser && targetUser.role === 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin accounts cannot be deleted.' });
      }

      const ok = await User.deleteById(req.params.id);
      if (!ok) return res.status(404).json({ success: false, message: 'User not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
  }

  // ============== BOOKS / RESOURCES ==============

  static async listBooks(req, res) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM books ORDER BY institution, title LIMIT 1000`
      );
      res.json({ success: true, count: rows.length, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to list books' });
    }
  }

  static async createBook(req, res) {
    try {
      const {
        title, author, isbn, category, level, quantity,
        availableQuantity, publishedYear, institution
      } = req.body;
      if (!title || !author || !quantity) {
        return res.status(400).json({ success: false, message: 'title, author, quantity required' });
      }
      const id = await Book.create({
        title, author, isbn, category, level,
        quantity, availableQuantity, publishedYear,
        institution, createdBy: req.user.id
      });
      res.status(201).json({ success: true, message: 'Book created', bookId: id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Failed to create book' });
    }
  }

  static async updateBook(req, res) {
    try {
      const ok = await Book.update(req.params.id, req.body);
      if (!ok) return res.status(404).json({ success: false, message: 'Book not found or no changes' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to update book' });
    }
  }

  static async deleteBook(req, res) {
    try {
      const ok = await Book.deleteById(req.params.id);
      if (!ok) return res.status(404).json({ success: false, message: 'Book not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to delete book' });
    }
  }

  // ============== STATS & INSTITUTION REQUESTS ==============

  static async getStats(req, res) {
    try {
      const [[users]] = await pool.execute(`SELECT COUNT(*) AS c FROM users WHERE role='STUDENT'`);
      const [[admins]] = await pool.execute(`SELECT COUNT(*) AS c FROM users WHERE role='ADMIN'`);
      const [[libs]] = await pool.execute(`SELECT COUNT(*) AS c FROM librarians`);
      const [[books]] = await pool.execute(`SELECT COUNT(*) AS c FROM books`);
      const [[reqs]] = await pool.execute(`SELECT COUNT(*) AS c FROM book_requests WHERE status='PENDING'`);
      const [[instReqs]] = await pool.execute(`SELECT COUNT(*) AS c FROM institution_requests WHERE status='PENDING'`);
      
      res.json({
        success: true,
        data: {
          students: users.c, admins: admins.c, librarians: libs.c,
          books: books.c, pendingRequests: reqs.c,
          pendingInstitutionRequests: instReqs.c
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Failed to load stats' });
    }
  }

  static async listInstitutionRequests(req, res) {
    try {
      const [rows] = await pool.execute(
        `SELECT ir.*, 
          COALESCE(u.full_name, l.full_name, u.username, l.username) AS account_name,
          COALESCE(u.email, l.email) AS account_email
         FROM institution_requests ir
         LEFT JOIN users u ON ir.user_id = u.id
         LEFT JOIN librarians l ON ir.librarian_id = l.id
         WHERE ir.status = 'PENDING'
         ORDER BY ir.created_at DESC`
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Failed to load institution requests' });
    }
  }

  static async processInstitutionRequest(req, res) {
    try {
      const { requestId } = req.params;
      const { action, adminNotes } = req.body; // action: 'APPROVE' | 'REJECT'

      const [rows] = await pool.execute(`SELECT * FROM institution_requests WHERE id = ? LIMIT 1`, [requestId]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Request not found' });
      }

      const r = rows[0];

      if (action === 'APPROVE') {
        const table = r.user_type === 'LIBRARIAN' ? 'librarians' : 'users';
        const targetId = r.user_type === 'LIBRARIAN' ? r.librarian_id : r.user_id;

        await pool.execute(`UPDATE ${table} SET institution = ? WHERE id = ?`, [r.requested_institution, targetId]);
        await pool.execute(`UPDATE institution_requests SET status = 'APPROVED', admin_notes = ? WHERE id = ?`, [adminNotes || '', requestId]);
      } else {
        await pool.execute(`UPDATE institution_requests SET status = 'REJECTED', admin_notes = ? WHERE id = ?`, [adminNotes || '', requestId]);
      }

      res.json({ success: true, message: `Request ${action.toLowerCase()}d successfully.` });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Failed to process request' });
    }
  }
}

module.exports = AdminController;
