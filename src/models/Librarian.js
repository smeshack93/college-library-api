const pool = require('../config/database');

class Librarian {
    static async findByUsername(username) {
        const [rows] = await pool.execute(
            'SELECT * FROM librarians WHERE username = ? AND is_active = 1',
            [username]
        );
        return rows[0] || null;
    }

    /**
     * Dedicated lookup for librarian password verification
     */
    static async findByIdWithPassword(id) {
        const [rows] = await pool.execute(
            'SELECT * FROM librarians WHERE id = ? AND is_active = 1',
            [id]
        );
        return rows[0] || null;
    }

    /**
     * Updates librarian password and related security flags
     */
    static async updatePassword(librarianId, newPasswordHash) {
        const [result] = await pool.execute(
            `UPDATE librarians 
             SET password = ?, 
                 password_format = 'PBKDF2',
                 password_migrated = 1,
                 force_password_change = 0
             WHERE id = ?`,
            [newPasswordHash, librarianId]
        );
        return result.affectedRows > 0;
    }

    static async getDashboardStats() {
        const [rows] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM users WHERE is_active = 1) as activeUsers,
                (SELECT COUNT(*) FROM books) as totalBooks,
                (SELECT IFNULL(SUM(available_quantity), 0) FROM books) as availableBooks,
                (SELECT COUNT(*) FROM book_requests WHERE status = 'PENDING') as pendingRequests,
                (SELECT COUNT(*) FROM book_requests) as totalRequests,
                (SELECT COUNT(*) FROM librarians WHERE is_active = 1) as activeLibrarians
        `);
        return rows[0];
    }

    static async getPendingBookRequests() {
        const [rows] = await pool.execute(`
            SELECT 
                br.id,
                br.user_id,
                br.book_id,
                br.request_date,
                br.status,
                br.request_type,
                u.full_name as student_name, 
                u.nta_level as student_nta_level,
                b.title as book_title,
                b.author as book_author
            FROM book_requests br
            JOIN users u ON br.user_id = u.id
            JOIN books b ON br.book_id = b.id
            WHERE br.status = 'PENDING'
            ORDER BY br.request_date DESC
        `);
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
