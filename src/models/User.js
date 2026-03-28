const pool = require('../config/database');

class User {
  static async findByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [email]
    );
    return rows[0];
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT id, username, email, full_name, nta_level FROM users WHERE id = ?',
      [id]
    );
    return rows[0];
  }

  static async create(userData) {
    const { username, email, fullName, password, ntaLevel } = userData;
    
    const [result] = await pool.execute(
      `INSERT INTO users 
       (username, email, full_name, password, nta_level, password_format, password_migrated, is_active) 
       VALUES (?, ?, ?, ?, ?, 'PBKDF2', 1, 1)`,
      [username, email, fullName, password, ntaLevel]
    );
    return result.insertId;
  }

  static async updatePassword(userId, newPasswordHash) {
    const [result] = await pool.execute(
      'UPDATE users SET password = ?, password_updated_at = NOW() WHERE id = ?',
      [newPasswordHash, userId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = User;