const Book = require('../models/Book');
const pool = require('../config/database');

class BookController {
  static async getAllBooks(req, res) {
    try {
      const books = await Book.findAll();
      res.json({
        success: true,
        count: books.length,
        data: books
      });
    } catch (error) {
      console.error('Get books error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch books' 
      });
    }
  }

  static async getBookById(req, res) {
    try {
      const book = await Book.findById(req.params.id);
      if (!book) {
        return res.status(404).json({ 
          success: false, 
          message: 'Book not found' 
        });
      }
      res.json({ success: true, data: book });
    } catch (error) {
      console.error('Get book error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch book' 
      });
    }
  }

  static async requestBook(req, res) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      const { userId, bookId } = req.body;

      // 1. Check book availability
      const [bookRows] = await connection.execute(
        'SELECT available_quantity FROM books WHERE id = ? FOR UPDATE',
        [bookId]
      );
      
      if (bookRows.length === 0 || bookRows[0].available_quantity <= 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Book not available'
        });
      }

      // 2. Check existing pending request
      const [existingRequest] = await connection.execute(
        `SELECT id FROM book_requests 
         WHERE user_id = ? AND book_id = ? 
         AND request_type = 'BORROW' AND status = 'PENDING'`,
        [userId, bookId]
      );

      if (existingRequest.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'You already have a pending request for this book'
        });
      }

      // 3. Create request
      const [result] = await connection.execute(
        `INSERT INTO book_requests 
         (user_id, book_id, request_type, request_date, status) 
         VALUES (?, ?, 'BORROW', NOW(), 'PENDING')`,
        [userId, bookId]
      );

      // 4. Update book availability
      await connection.execute(
        'UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ?',
        [bookId]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'Book requested successfully',
        requestId: result.insertId
      });

    } catch (error) {
      await connection.rollback();
      console.error('Request book error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to request book' 
      });
    } finally {
      connection.release();
    }
  }

  // Handle the /users/:id/borrows endpoint correctly
  static async getUserBorrows(req, res) {
    try {
      const userId = req.params.id;
      
      console.log(`🔍 Fetching borrows for user ID: ${userId}`);
      console.log(`👤 Requesting user: ${req.user?.id}, Type: ${req.user?.type}`);
      
      // Check if user exists
      const [users] = await pool.execute(
        'SELECT id, full_name FROM users WHERE id = ?',
        [userId]
      );
      
      if (users.length === 0) {
        console.log(`❌ User ${userId} not found`);
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      console.log(`✅ User found: ${users[0].full_name}`);

      // Get all borrow requests for this user (including all statuses)
      const [rows] = await pool.execute(`
        SELECT 
          br.id as requestId,
          br.book_id as bookId,
          br.request_date as requestDate,
          br.status,
          br.request_type as requestType,
          br.due_date as dueDate,
          br.borrow_date as borrowDate,
          br.approval_date as approvalDate,
          br.notes,
          b.title as bookTitle,
          b.author as bookAuthor,
          b.isbn,
          b.category,
          b.nta_level as ntaLevel,
          l.full_name as librarianName
        FROM book_requests br
        JOIN books b ON br.book_id = b.id
        LEFT JOIN librarians l ON br.approved_by = l.id
        WHERE br.user_id = ?
        ORDER BY br.request_date DESC
      `, [userId]);

      console.log(`📚 Found ${rows.length} borrow requests for user ${userId}`);

      // If no requests found, return empty array (not error)
      if (rows.length === 0) {
        return res.json({
          success: true,
          count: 0,
          data: []
        });
      }

      const formattedBorrows = rows.map(row => ({
        requestId: row.requestId,
        bookId: row.bookId,
        bookTitle: row.bookTitle || 'Unknown Book',
        bookAuthor: row.bookAuthor || 'Unknown Author',
        isbn: row.isbn || 'N/A',
        status: row.status || 'PENDING',
        requestDate: row.requestDate,
        borrowDate: row.borrowDate || row.requestDate, // Fallback to requestDate
        dueDate: row.dueDate || null,
        category: row.category || 'General',
        ntaLevel: row.ntaLevel || 'N/A',
        requestType: row.requestType || 'BORROW',
        notes: row.notes || '',
        librarianName: row.librarianName || null
      }));

      res.json({
        success: true,
        count: formattedBorrows.length,
        data: formattedBorrows
      });

    } catch (error) {
      console.error('Error fetching user borrows:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch borrow requests: ' + error.message
      });
    }
  }
}

module.exports = BookController;
