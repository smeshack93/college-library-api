const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
                `SELECT id, username, password, full_name, employee_id, email, phone, is_active 
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

            const isMatch = await bcrypt.compare(password, librarian.password);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid librarian credentials'
                });
            }

            const token = jwt.sign(
                {
                    id: librarian.id,
                    username: librarian.username,
                    employeeId: librarian.employee_id,
                    role: 'librarian'
                },
                process.env.JWT_SECRET || 'your_fallback_secret_key',
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
                    br.user_id,
                    u.full_name AS user_name,
                    u.email AS user_email,
                    br.book_id,
                    b.title AS book_title,
                    b.author AS book_author,
                    b.isbn,
                    br.request_type,
                    br.status,
                    br.request_date,
                    br.created_at
                FROM book_requests br
                JOIN users u ON br.user_id = u.id
                JOIN books b ON br.book_id = b.id
                WHERE br.status = 'PENDING'
                ORDER BY br.created_at ASC
            `);

            res.json({
                success: true,
                count: rows ? rows.length : 0,
                requests: rows || []
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
                    `SELECT available_copies FROM books WHERE id = ? FOR UPDATE`,
                    [request.book_id]
                );

                if (!books || books.length === 0 || books[0].available_copies <= 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Book is currently out of stock'
                    });
                }

                await connection.execute(
                    `UPDATE books SET available_copies = available_copies - 1 WHERE id = ?`,
                    [request.book_id]
                );

                const borrowDate = new Date();
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 14);

                await connection.execute(
                    `INSERT INTO user_borrows (user_id, book_id, borrow_date, due_date, status, created_at)
                     VALUES (?, ?, ?, ?, 'BORROWED', NOW())`,
                    [request.user_id, request.book_id, borrowDate, dueDate]
                );
            } else if (request.request_type === 'RETURN') {
                await connection.execute(
                    `UPDATE books SET available_copies = available_copies + 1 WHERE id = ?`,
                    [request.book_id]
                );

                await connection.execute(
                    `UPDATE user_borrows 
                     SET status = 'RETURNED', return_date = NOW() 
                     WHERE user_id = ? AND book_id = ? AND status = 'BORROWED'
                     ORDER BY borrow_date ASC LIMIT 1`,
                    [request.user_id, request.book_id]
                );
            }

            await connection.execute(
                `UPDATE book_requests 
                 SET status = 'APPROVED', processed_by = ?, processed_at = NOW() 
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
            const { rejectionReason } = req.body;
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
                 SET status = 'REJECTED', rejection_reason = ?, processed_by = ?, processed_at = NOW() 
                 WHERE id = ?`,
                [rejectionReason || 'No reason provided', librarianId, requestId]
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
            const [[pendingRequests]] = await pool.execute(`SELECT COUNT(*) AS count FROM book_requests WHERE status = 'PENDING'`);
            const [[activeBorrows]] = await pool.execute(`SELECT COUNT(*) AS count FROM user_borrows WHERE status = 'BORROWED'`);
            const [[totalUsers]] = await pool.execute(`SELECT COUNT(*) AS count FROM users`);

            res.json({
                success: true,
                statistics: {
                    totalBooks: totalBooks ? totalBooks.count : 0,
                    pendingRequests: pendingRequests ? pendingRequests.count : 0,
                    activeBorrows: activeBorrows ? activeBorrows.count : 0,
                    totalUsers: totalUsers ? totalUsers.count : 0
                }
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
     */
    static async getRequestHistory(req, res) {
        try {
            const { status, requestType, search, limit = 50 } = req.query;

            let query = `
                SELECT 
                    br.id,
                    br.user_id,
                    u.full_name AS user_name,
                    u.email AS user_email,
                    br.book_id,
                    b.title AS book_title,
                    br.request_type,
                    br.status,
                    br.rejection_reason,
                    br.remarks,
                    br.created_at,
                    br.processed_at
                FROM book_requests br
                JOIN users u ON br.user_id = u.id
                JOIN books b ON br.book_id = b.id
                WHERE 1=1
            `;

            const params = [];

            if (status) {
                query += ` AND br.status = ?`;
                params.push(status.toUpperCase());
            }

            if (requestType) {
                query += ` AND br.request_type = ?`;
                params.push(requestType.toUpperCase());
            }

            if (search) {
                query += ` AND (u.full_name LIKE ? OR b.title LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY br.created_at DESC LIMIT ?`;
            params.push(parseInt(limit, 10));

            const [rows] = await pool.execute(query, params);

            res.json({
                success: true,
                count: rows ? rows.length : 0,
                history: rows || []
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

            if (!remark) {
                return res.status(400).json({
                    success: false,
                    message: 'Remark content is required'
                });
            }

            await pool.execute(
                `UPDATE book_requests SET remarks = ? WHERE id = ?`,
                [remark, requestId]
            );

            res.json({
                success: true,
                message: 'Remark updated successfully'
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
                `UPDATE librarians SET password = ? WHERE id = ?`,
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
