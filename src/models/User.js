const crypto = require('crypto');
const { pool } = require('../config/database');

class User {
  static async findByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [email]
    );
    return rows[0] || null;
  }

  static async findByUsername(username) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT id, username, email, full_name, level, phone, institution, role
         FROM users WHERE id = ? AND is_active = 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByIdWithPassword(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE id = ? AND is_active = 1',
      [id]
    );
    return rows[0] || null;
  }

  static async create({ username, email, fullName, password, level, phone, institution, role = 'STUDENT' }) {
    const [result] = await pool.execute(
      `INSERT INTO users 
       (username, email, full_name, password, level, phone, institution, role, password_format, password_migrated, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PBKDF2', 1, 1)`,
      [username, email, fullName, password, level, phone || null, institution || null, role]
    );
    return result.insertId;
  }

  static async updatePassword(userId, hashedPassword) {
    const [result] = await pool.execute(
      `UPDATE users 
       SET password = ?, password_updated_at = NOW(), 
           reset_token = NULL, reset_token_expires = NULL,
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
      `UPDATE users SET reset_token = ?, reset_token_expires = ?
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
      `UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
      [userId]
    );
    return result.affectedRows > 0;
  }

  // ====== Admin operations ======
  static async listAll({ role = null, institution = null, search = null } = {}) {
    let q = `SELECT id, username, email, full_name, level, phone, institution, role, is_active, created_at
               FROM users WHERE 1=1`;
    const p = [];
    if (role) { q += ' AND role = ?'; p.push(role); }
    if (institution) { q += ' AND institution = ?'; p.push(institution); }
    if (search) { q += ' AND (full_name LIKE ? OR email LIKE ? OR username LIKE ?)';
      const t = `%${search}%`; p.push(t, t, t); }
    q += ' ORDER BY created_at DESC LIMIT 500';
    const [rows] = await pool.execute(q, p);
    return rows;
  }

  static async setActive(userId, active) {
    const [r] = await pool.execute(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [active ? 1 : 0, userId]
    );
    return r.affectedRows > 0;
  }

  static async deleteById(userId) {
    const [r] = await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    return r.affectedRows > 0;
  }
}

module.exports = User;
