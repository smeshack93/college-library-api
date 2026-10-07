const { pool } = require('../config/database');

class Librarian {
    static async findByUsername(username) {
        const [rows] = await pool.execute(
            'SELECT * FROM librarians WHERE username = ? AND is_active = 1',
            [username]
        );
        return rows[0] || null;
    }

    static async findByUsernameOrEmailOrEmployee(idLike) {
        const [rows] = await pool.execute(
            `SELECT * FROM librarians 
              WHERE (username = ? OR email = ? OR employee_id = ?) AND is_active = 1`,
            [idLike, idLike, idLike]
        );
        return rows[0] || null;
    }

    static async findById(id) {
        const [rows] = await pool.execute(
            `SELECT id, username, email, full_name, employee_id, phone, institution
               FROM librarians WHERE id = ? AND is_active = 1`,
            [id]
        );
        return rows[0] || null;
    }

    static async findByIdWithPassword(id) {
        const [rows] = await pool.execute(
            'SELECT * FROM librarians WHERE id = ? AND is_active = 1',
            [id]
        );
        return rows[0] || null;
    }

    static async updatePassword(librarianId, newPasswordHash) {
        const [result] = await pool.execute(
            `UPDATE librarians 
              SET password = ?, password_format = 'PBKDF2',
                  password_migrated = 1, force_password_change = 0
              WHERE id = ?`,
            [newPasswordHash, librarianId]
        );
        return result.affectedRows > 0;
    }

    static async create({ username, password, email, phone, fullName, employeeId, institution }) {
        const [r] = await pool.execute(
            `INSERT INTO librarians
              (username, password, email, phone, full_name, employee_id, institution,
               password_format, password_migrated, is_active, force_password_change)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PBKDF2', 1, 1, 0)`,
            [username, password, email, phone, fullName, employeeId, institution]
        );
        return r.insertId;
    }

    static async listAll({ institution = null, search = null } = {}) {
        let q = `SELECT id, username, email, full_name, employee_id, phone, institution, is_active, created_at
                   FROM librarians WHERE 1=1`;
        const p = [];
        if (institution) { q += ' AND institution = ?'; p.push(institution); }
        if (search) { q += ' AND (full_name LIKE ? OR email LIKE ? OR employee_id LIKE ?)';
            const t = `%${search}%`; p.push(t, t, t); }
        q += ' ORDER BY created_at DESC LIMIT 500';
        const [rows] = await pool.execute(q, p);
        return rows;
    }

    static async setActive(id, active) {
        const [r] = await pool.execute('UPDATE librarians SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
        return r.affectedRows > 0;
    }

    static async deleteById(id) {
        const [r] = await pool.execute('DELETE FROM librarians WHERE id = ?', [id]);
        return r.affectedRows > 0;
    }

    static async getDashboardStats(institution = null) {
        const instFilter = institution ? ' AND institution = ?' : '';
        const p = institution ? [institution] : [];

        const [[users]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM users WHERE is_active = 1 ${institution ? 'AND institution = ?' : ''}`,
            institution ? [institution] : []
        );
        const [[books]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM books WHERE 1=1 ${instFilter}`, p
        );
        const [[avail]] = await pool.execute(
            `SELECT IFNULL(SUM(available_quantity),0) AS c FROM books WHERE 1=1 ${instFilter}`, p
        );
        const [[pending]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM book_requests br
              JOIN books b ON br.book_id = b.id
              WHERE br.status = 'PENDING' ${institution ? 'AND b.institution = ?' : ''}`,
            institution ? [institution] : []
        );
        const [[libs]] = await pool.execute(
            `SELECT COUNT(*) AS c FROM librarians WHERE is_active = 1 ${instFilter}`, p
        );

        return {
            activeUsers: users.c,
            totalBooks: books.c,
            availableBooks: Number(avail.c),
            pendingRequests: pending.c,
            activeLibrarians: libs.c
        };
    }

    static async getPendingBookRequests(institution = null) {
        const filter = institution ? 'AND b.institution = ?' : '';
        const p = institution ? [institution] : [];
        const [rows] = await pool.execute(`
            SELECT br.id, br.user_id, br.book_id, br.request_date, br.status, br.request_type,
                   u.full_name AS student_name, u.level AS student_nta_level,
                   b.title AS book_title, b.author AS book_author
              FROM book_requests br
              JOIN users u ON br.user_id = u.id
              JOIN books b ON br.book_id = b.id
             WHERE br.status = 'PENDING' ${filter}
             ORDER BY br.request_date DESC
        `, p);
        return rows;
    }

    static async updateRequestStatus(requestId, status, librarianId, notes = null) {
        const [result] = await pool.execute(
            `UPDATE book_requests 
              SET status = ?, approved_by = ?, approval_date = NOW(), notes = ?
              WHERE id = ?`,
            [status, librarianId, notes, requestId]
        );
        return result.affectedRows > 0;
    }
}

module.exports = Librarian;
