const crypto = require('crypto');
const pool = require('../config/database');

class User {
  static async findByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [email]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT id, username, email, full_name, level, nta_level, phone, college FROM users WHERE id = ? AND is_active = 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Dedicated lookup method for authentication procedures needing password verification.
   * Fetches active user record with hashed password field included.
   */
  static async findByIdWithPassword(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE id = ? AND is_active = 1',
      [id]
    );
    return rows[0] || null;
  }

  static async create({ username, email, fullName, password, level, ntaLevel, phone, college }) {
    // Fallback if caller passed ntaLevel instead of level
    const userLevel = level || ntaLevel || '';

    const [result] = await pool.execute(
      `INSERT INTO users 
       (username, email, full_name, password, level, nta_level, phone, college, password_format, password_migrated, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PBKDF2', 1, 1)`,
      [username, email, fullName, password, userLevel, userLevel, phone || null, college || null]
    );
    return result.insertId;
  }

  static async updatePassword(userId, hashedPassword) {
    const [result] = await pool.execute(
      `UPDATE users 
       SET password = ?, 
           password_updated_at = NOW(), 
           reset_token = NULL, 
           reset_token_expires = NULL,
           force_password_change = 0 
       WHERE id = ?`,
      [hashedPassword, userId]
    );
    return result.affectedRows > 0;
  }

  static async setResetToken(email, token, expiresAt) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const formattedExpiresAt = new Date(expiresAt).toISOString().slice(0, 19).replace('T', ' ');

    const [result] = await pool.execute(
      `UPDATE users 
       SET reset_token = ?, reset_token_expires = ? 
       WHERE email = ? AND is_active = 1`,
      [hashedToken, formattedExpiresAt, email]
    );
    return result.affectedRows > 0;
  }

  static async findByResetToken(token) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const [rows] = await pool.execute(
      `SELECT * FROM users 
       WHERE reset_token = ? AND reset_token_expires > NOW() AND is_active = 1`,
      [hashedToken]
    );
    return rows[0] || null;
  }

  static async clearResetToken(userId) {
    const [result] = await pool.execute(
      `UPDATE users 
       SET reset_token = NULL, reset_token_expires = NULL 
       WHERE id = ?`,
      [userId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = User;
