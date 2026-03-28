const pool = require('../config/database');

class Book {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT * FROM books WHERE quantity > 0 ORDER BY title'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM books WHERE id = ?',
      [id]
    );
    return rows[0];
  }

  static async updateAvailability(bookId, newAvailableQuantity) {
    const [result] = await pool.execute(
      'UPDATE books SET available_quantity = ? WHERE id = ?',
      [newAvailableQuantity, bookId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = Book;