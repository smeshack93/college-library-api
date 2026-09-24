const crypto = require('crypto');
const pool = require('../config/database');

class User {
  // --- Existing Unchanged Methods ---

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

  /**
   * Dedicated lookup method for authentication procedures needing password verification.
   * Uses SELECT * to fetch full user record and avoid undefined hash/metadata errors.
   */
  static async findByIdWithPassword(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE id = ? AND is_active = 1',
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
      `UPDATE users 
       SET password = ?, 
           password_updated_at = NOW(), 
           reset_token = NULL, 
           reset_token_expires = NULL 
       WHERE id = ?`,
      [newPasswordHash, userId]
    );
    return result.affectedRows > 0;
  }

  // --- Reset Token Methods ---

  /**
   * Hashes the raw token and saves it alongside the expiration date.
   */
  static async setResetToken(email, token, expiresAt) {
    // Hash token using SHA-256 for secure storage
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

  /**
   * Hashes incoming plain token and queries DB for active match.
   */
  static async findByResetToken(token) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const [rows] = await pool.execute(
      `SELECT * FROM users 
       WHERE reset_token = ? AND reset_token_expires > NOW() AND is_active = 1`,
      [hashedToken]
    );
    return rows[0];
  }

  /**
   * Clears the reset token and expiration fields for a user.
   */
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
