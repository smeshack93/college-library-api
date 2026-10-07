const { pool } = require('../config/database');

class Book {
  static async findAll({ institution = null, level = null, search = null } = {}) {
    let q = 'SELECT * FROM books WHERE quantity > 0';
    const p = [];
    if (institution) { q += ' AND institution = ?'; p.push(institution); }
    if (level) { q += ' AND level = ?'; p.push(level); }
    if (search) {
      q += ' AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?)';
      const t = `%${search}%`; p.push(t, t, t);
    }
    q += ' ORDER BY title';
    const [rows] = await pool.execute(q, p);
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute('SELECT * FROM books WHERE id = ?', [id]);
    return rows[0];
  }

  static async updateAvailability(bookId, newAvailableQuantity) {
    const [r] = await pool.execute(
      'UPDATE books SET available_quantity = ? WHERE id = ?',
      [newAvailableQuantity, bookId]
    );
    return r.affectedRows > 0;
  }

  static async create({
    title, author, isbn, category, level, quantity,
    availableQuantity, publishedYear, institution, createdBy
  }) {
    const [r] = await pool.execute(
      `INSERT INTO books
         (title, author, isbn, category, level, quantity, available_quantity,
          published_year, institution, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        title, author, isbn, category, level,
        quantity, availableQuantity ?? quantity,
        publishedYear ?? null, institution ?? null, createdBy ?? null
      ]
    );
    return r.insertId;
  }

  static async update(id, fields) {
    const allowed = ['title','author','isbn','category','level','quantity',
                     'available_quantity','published_year','institution'];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (keys.length === 0) return false;
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => fields[k]);
    vals.push(id);
    const [r] = await pool.execute(`UPDATE books SET ${sets} WHERE id = ?`, vals);
    return r.affectedRows > 0;
  }

  static async deleteById(id) {
    const [r] = await pool.execute('DELETE FROM books WHERE id = ?', [id]);
    return r.affectedRows > 0;
  }
}

module.exports = Book;
