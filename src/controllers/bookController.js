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
}

module.exports = BookController;