const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Helper function to verify PBKDF2 hashes stored in format:
 * PBKDF2:iterations:saltBase64:hashBase64
 */
function verifyPbkdf2Password(password, storedHash) {
    try {
        const parts = storedHash.split(':');
        if (parts.length !== 4 || parts[0] !== 'PBKDF2') {
            return false;
        }

        const iterations = parseInt(parts[1], 10);
        const salt = Buffer.from(parts[2], 'base64');
        const originalHash = Buffer.from(parts[3], 'base64');

        const keylen = originalHash.length;

        const derivedHash = crypto.pbkdf2Sync(
            password,
            salt,
            iterations,
            keylen,
            'sha256'
        );

        return crypto.timingSafeEqual(originalHash, derivedHash);
    } catch (err) {
        console.error('PBKDF2 Verification Error:', err);
        return false;
    }
}

/**
 * Helper function to verify passwords regardless of format (BCRYPT or PBKDF2)
 */
async function verifyPassword(inputPassword, librarian) {
    const storedHash = librarian.password;

    if (!storedHash) return false;

    if (storedHash.startsWith('PBKDF2:') || librarian.password_format === 'PBKDF2') {
        return verifyPbkdf2Password(inputPassword, storedHash);
    }

    return await bcrypt.compare(inputPassword, storedHash);
}

class LibrarianController {

    /**
     * Get logged-in Librarian profile details
     * GET /api/librarian/profile
     */
    static async getProfile(req, res) {
        try {
            const librarianId = req.user.id;
            const [rows] = await pool.execute(
               `SELECT id, username, full_name, employee_id, email, phone 
                 FROM librarians 
                 WHERE id = ? AND is_active = 1`,
                [librarianId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Librarian not found'
                });
            }

            res.json({
                success: true,
                librarian: {
                    id: rows[0].id,
                    username: rows[0].username,
                    fullName: rows[0].full_name,
                    employeeId: rows[0].employee_id,
                    email: rows[0].email,
                    phone: rows[0].phone || "N/A"
                }
            });
        } catch (error) {
            console.error('Get librarian profile error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve profile information'
            });
        }
    }

    /**
     * Librarian Login
     * POST /api/librarian/login
     */
    static async login(req, res) {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username and password are required'
                });
            }

            const [rows] = await pool.execute(
                `SELECT id, username, password, password_format, full_name, employee_id, email, phone, is_active 
                 FROM librarians 
                 WHERE username = ? OR employee_id = ? OR email = ?`,
                [username, username, username]
            );

            if (!rows || !Array.isArray(rows) || rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid librarian credentials'
                });
            }

            const librarian = rows[0];

            if (!librarian.is_active) {
                return res.status(403).json({
                    success: false,
                    message: 'Account is inactive. Contact system administrator.'
                });
            }

            const isMatch = await verifyPassword(password, librarian);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid librarian credentials'
                });
            }

            const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

            const token = jwt.sign(
                {
                    id: librarian.id,
                    username: librarian.username,
                    employeeId: librarian.employee_id,
                    type: 'LIBRARIAN',
                    role: 'librarian'
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                message: 'Librarian authentication successful',
                token,
                librarian: {
                    id: librarian.id,
                    username: librarian.username,
                    fullName: librarian.full_name,
                    employeeId: librarian.employee_id,
                    email: librarian.email,
                    phone: librarian.phone || "N/A"
                }
            });
        } catch (error) {
            console.error('Librarian login error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during authentication'
            });
        }
    }

    /**
     * Get pending requests for approval/rejection
     * GET /api/librarian/requests/pending
     */
    static async getPendingRequests(req, res) {
        try {
            const [rows] = await pool.execute(`
                SELECT 
                    br.id,
                    br.user_id AS userId,
                    u.full_name AS userName,
                    u.email AS userEmail,
                    u.nta_level AS userNtaLevel,
                    br.book_id AS bookId,
                    b.title AS bookTitle,
                    b.author AS bookAuthor,
                    b.isbn AS bookIsbn,
                    br.request_type AS requestType,
                    br.status,
                    br.request_date AS requestDate,
                    br.notes,
                    br.remark AS remarks
                FROM book_requests br
                JOIN users u ON br.user_id = u.id
                JOIN books b ON br.book_id = b.id
                WHERE br.status = 'PENDING'
                ORDER BY br.request_date ASC
            `);

            res.json({
                success: true,
                count: rows ? rows.length : 0,
                requests: rows || [],
                data: rows || []
            });
        } catch (error) {
            console.error('Get pending requests error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve pending requests'
            });
        }
    }

    /**
     * Approve book borrow or return request
     * POST /api/librarian/requests/:id/approve
     */
    static async approveRequest(req, res) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const requestId = req.params.id;
            const librarianId = req.user ? req.user.id : null;

            const [requests] = await connection.execute(
                `SELECT * FROM book_requests WHERE id = ? AND status = 'PENDING'`,
                [requestId]
            );

            if (!requests || requests.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Pending request not found'
                });
            }

            const request = requests[0];

            if (request.request_type === 'BORROW') {
                const [books] = await connection.execute(
                    `SELECT available_quantity FROM books WHERE id = ? FOR UPDATE`,
                    [request.book_id]
                );

                if (!books || books.length === 0 || books[0].available_quantity <= 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Book is currently out of stock'
                    });
                }

                await connection.execute(
                    `UPDATE books SET available_quantity = available_quantity - 1 WHERE id = ?`,
                    [request.book_id]
                );

                const borrowDate = new Date();
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 14);

                try {
                    await connection.execute(
                        `INSERT INTO borrows (user_id, book_id, borrow_date, due_date, status, created_at)
                         VALUES (?, ?, ?, ?, 'BORROWED', NOW())`,
                        [request.user_id, request.book_id, borrowDate, dueDate]
                    );
                } catch (err) {
                    try {
                        await connection.execute(
                            `INSERT INTO user_borrows (user_id, book_id, borrow_date, due_date, status, created_at)
                             VALUES (?, ?, ?, ?, 'BORROWED', NOW())`,
                            [request.user_id, request.book_id, borrowDate, dueDate]
                        );
                    } catch (e) {
                        // Borrows table insertion fallback silently handled if tracked only via requests
                    }
                }
            } else if (request.request_type === 'RETURN') {
                await connection.execute(
                    `UPDATE books SET available_quantity = available_quantity + 1 WHERE id = ?`,
                    [request.book_id]
                );

                try {
                    await connection.execute(
                        `UPDATE borrows 
                         SET status = 'RETURNED', return_date = NOW() 
                         WHERE user_id = ? AND book_id = ? AND status = 'BORROWED'
                         ORDER BY borrow_date ASC LIMIT 1`,
                        [request.user_id, request.book_id]
                    );
                } catch (err) {
                    try {
                        await connection.execute(
                            `UPDATE user_borrows 
                             SET status = 'RETURNED', return_date = NOW() 
                             WHERE user_id = ? AND book_id = ? AND status = 'BORROWED'
                             ORDER BY borrow_date ASC LIMIT 1`,
                            [request.user_id, request.book_id]
                        );
                    } catch (e) {
                        // Borrows table update fallback
                    }
                }
            }

            await connection.execute(
                `UPDATE book_requests 
                 SET status = 'APPROVED', approved_by = ?, approval_date = NOW() 
                 WHERE id = ?`,
                [librarianId, requestId]
            );

            await connection.commit();

            res.json({
                success: true,
                message: `Request successfully approved (${request.request_type})`
            });
        } catch (error) {
            await connection.rollback();
            console.error('Approve request error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to approve request'
            });
        } finally {
            connection.release();
        }
    }

    /**
     * Reject request with reason
     * POST /api/librarian/requests/:id/reject
     */
    static async rejectRequest(req, res) {
        try {
            const requestId = req.params.id;
            const { rejectionReason, reason, notes } = req.body;
            const finalReason = rejectionReason || reason || notes || 'No reason provided';
            const librarianId = req.user ? req.user.id : null;

            const [requests] = await pool.execute(
                `SELECT * FROM book_requests WHERE id = ? AND status = 'PENDING'`,
                [requestId]
            );

            if (!requests || requests.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Pending request not found'
                });
            }

            await pool.execute(
                `UPDATE book_requests 
                 SET status = 'REJECTED', notes = ?, remark = ?, remark_by = ?, remark_date = NOW() 
                 WHERE id = ?`,
                [finalReason, finalReason, librarianId, requestId]
            );

            res.json({
                success: true,
                message: 'Request successfully rejected'
            });
        } catch (error) {
            console.error('Reject request error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to reject request'
            });
        }
    }

    /**
     * Get dashboard summary statistics
     * GET /api/librarian/statistics
     */
    static async getStatistics(req, res) {
        try {
            const [[totalBooks]] = await pool.execute(`SELECT COUNT(*) AS count FROM books`);
            const [[availableBooks]] = await pool.execute(`SELECT SUM(available_quantity) AS count FROM books`);
            const [[pendingRequests]] = await pool.execute(`SELECT COUNT(*) AS count FROM book_requests WHERE status = 'PENDING'`);
            const [[totalUsers]] = await pool.execute(`SELECT COUNT(*) AS count FROM users`);
            
            let activeLibrariansCount = 0;
            try {
                const [[librarians]] = await pool.execute(`SELECT COUNT(*) AS count FROM librarians WHERE is_active = 1`);
                activeLibrariansCount = librarians ? librarians.count : 0;
            } catch (e) {
                activeLibrariansCount = 1;
            }

            let activeBorrowsCount = 0;
            try {
                const [[borrows]] = await pool.execute(`SELECT COUNT(*) AS count FROM book_requests WHERE status = 'APPROVED' AND request_type = 'BORROW'`);
                activeBorrowsCount = borrows ? borrows.count : 0;
            } catch (e) {
                activeBorrowsCount = 0;
            }

            const statsData = {
                activeUsers: totalUsers ? totalUsers.count : 0,
                active_users: totalUsers ? totalUsers.count : 0,
                activeLibrarians: activeLibrariansCount,
                active_librarians: activeLibrariansCount,
                totalBooks: totalBooks ? totalBooks.count : 0,
                total_books: totalBooks ? totalBooks.count : 0,
                availableBooks: availableBooks && availableBooks.count !== null ? Number(availableBooks.count) : 0,
                available_books: availableBooks && availableBooks.count !== null ? Number(availableBooks.count) : 0,
                pendingRequests: pendingRequests ? pendingRequests.count : 0,
                pending_requests: pendingRequests ? pendingRequests.count : 0,
                activeBorrows: activeBorrowsCount
            };

            res.json({
                success: true,
                statistics: statsData,
                data: statsData
            });
        } catch (error) {
            console.error('Get statistics error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve dashboard statistics'
            });
        }
    }

    /**
     * Get request history with optional filtering
     * GET /api/librarian/requests/history
     *
     * NOTE: LIMIT is inlined as a validated integer literal (clamped 1–1000)
     * to avoid MySQL 8's strict prepared-statement typing which throws
     * ER_WRONG_ARGUMENTS (errno 1210) when LIMIT is bound as a parameter
     * alongside string parameters.
     */
    static async getRequestHistory(req, res) {
        try {
            const { status, requestType, search, limit } = req.query;

            // Safely parse limit and default to 200 if missing or invalid.
            // Clamp to a hard ceiling to prevent accidental large scans.
            const parsedLimit = parseInt(limit, 10);
            let finalLimit = (!isNaN(parsedLimit) && parsedLimit > 0) ? parsedLimit : 200;
            if (finalLimit > 1000) finalLimit = 1000;

            let query = `
                SELECT 
                    br.id,
                    br.user_id AS userId,
                    u.full_name AS userName,
                    u.email AS userEmail,
                    u.nta_level AS userNtaLevel,
                    br.book_id AS bookId,
                    b.title AS bookTitle,
                    b.author AS bookAuthor,
                    br.request_type AS requestType,
                    br.status,
                    br.notes,
                    br.remark AS remarks,
                    br.request_date AS requestDate,
                    br.approval_date AS processedAt
                FROM book_requests br
                JOIN users u ON br.user_id = u.id
                JOIN books b ON br.book_id = b.id
                WHERE 1=1
            `;

            const params = [];

            if (status && status !== 'ALL') {
                query += ` AND br.status = ?`;
                params.push(String(status).toUpperCase());
            }

            if (requestType && requestType !== 'ALL') {
                query += ` AND br.request_type = ?`;
                params.push(String(requestType).toUpperCase());
            }

            if (search && String(search).trim() !== '') {
                const term = `%${String(search).trim()}%`;
                query += ` AND (u.full_name LIKE ? OR b.title LIKE ?)`;
                params.push(term, term);
            }

            // ✅ Inline LIMIT as a validated integer literal (safe — value is a
            // JS number clamped between 1 and 1000). This avoids MySQL 8 strict
            // prepared-statement type errors (ER_WRONG_ARGUMENTS 1210).
            query += ` ORDER BY br.request_date DESC LIMIT ${finalLimit}`;

            const [rows] = await pool.execute(query, params);

            res.json({
                success: true,
                count: rows ? rows.length : 0,
                history: rows || [],
                data: rows || []
            });
        } catch (error) {
            console.error('Get request history error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve request history'
            });
        }
    }

    /**
     * Add remark to a request
     * POST /api/librarian/requests/:id/remark
     */
    static async addRequestRemark(req, res) {
        try {
            const requestId = req.params.id;
            const { remark } = req.body;
            const librarianId = req.user ? req.user.id : null;

            if (!remark) {
                return res.status(400).json({
                    success: false,
                    message: 'Remark content is required'
                });
            }

            await pool.execute(
                `UPDATE book_requests SET remark = ?, remark_by = ?, remark_date = NOW() WHERE id = ?`,
                [remark, librarianId, requestId]
            );

            res.json({
                success: true,
                message: 'Remark updated successfully',
                data: {
                    remark,
                    remarkByName: req.user ? req.user.username : 'Librarian',
                    remarkDate: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Add remark error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to add remark'
            });
        }
    }

    /**
     * Verify Librarian Identity for Password Reset
     * POST /api/librarian/verify-identity
     */
    static async verifyIdentity(req, res) {
        try {
            const { username, employeeId, email } = req.body;

            const [rows] = await pool.execute(
                `SELECT id FROM librarians WHERE username = ? AND employee_id = ? AND email = ? AND is_active = 1`,
                [username, employeeId, email]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No matching active librarian account found with these details.'
                });
            }

            res.json({
                success: true,
                message: 'Identity verified successfully.'
            });
        } catch (error) {
            console.error('Verify identity error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to verify identity.'
            });
        }
    }

    /**
     * Reset Librarian Password
     * POST /api/librarian/reset-password
     */
    static async resetPassword(req, res) {
        try {
            const { username, employeeId, newPassword } = req.body;

            if (!newPassword || newPassword.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 8 characters long.'
                });
            }

            const [rows] = await pool.execute(
                `SELECT id FROM librarians WHERE username = ? AND employee_id = ? AND is_active = 1`,
                [username, employeeId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Account non-existent or inactive.'
                });
            }

            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(newPassword, salt);

            await pool.execute(
                `UPDATE librarians SET password = ?, password_format = 'BCRYPT' WHERE id = ?`,
                [passwordHash, rows[0].id]
            );

            res.json({
                success: true,
                message: 'Password reset successfully. You can now login.'
            });
        } catch (error) {
            console.error('Reset password error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to reset password.'
            });
        }
    }
}

module.exports = LibrarianController;
