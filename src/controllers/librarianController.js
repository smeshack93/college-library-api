// controllers/librarianController.js
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');

class LibrarianController {

    /**
     * Librarian login
     * POST /api/librarian/login
     */
    static async login(req, res) {
        try {
            const { username, password } = req.body;
            
            const [librarians] = await pool.execute(
                'SELECT * FROM librarians WHERE username = ? AND is_active = TRUE',
                [username]
            );
            
            if (librarians.length === 0) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid credentials' 
                });
            }
            
            const librarian = librarians[0];
            const isValid = verifyPassword(password, librarian.password);
            
            if (!isValid) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid credentials' 
                });
            }
            
            const token = jwt.sign(
                { 
                    id: librarian.id, 
                    username: librarian.username,
                    type: 'LIBRARIAN' 
                },
                process.env.JWT_SECRET || 'your-secret-key-change-this',
                { expiresIn: '24h' }
            );
            
            res.json({ 
                success: true, 
                token, 
                librarian: { 
                    id: librarian.id, 
                    username: librarian.username,
                    fullName: librarian.full_name,
                    employeeId: librarian.employee_id,
                    email: librarian.email,
                    forcePasswordChange: librarian.force_password_change === 1
                } 
            });
        } catch (error) {
            console.error('Librarian login error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Server error: ' + error.message 
            });
        }
    }

    /**
     * Verify librarian identity for password reset
     * POST /api/librarian/verify-identity
     */
    static async verifyIdentity(req, res) {
        try {
            const { employeeId, fullName, email } = req.body;
            
            if (!employeeId || !fullName || !email) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'All fields are required' 
                });
            }
            
            const [librarians] = await pool.execute(
                `SELECT id, employee_id, full_name, email 
                 FROM librarians 
                 WHERE employee_id = ? AND is_active = TRUE`,
                [employeeId]
            );
            
            if (librarians.length === 0) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Librarian not found' 
                });
            }
            
            const librarian = librarians[0];
            
            if (librarian.full_name.toLowerCase() !== fullName.toLowerCase() ||
                librarian.email.toLowerCase() !== email.toLowerCase()) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Information does not match our records' 
                });
            }
            
            res.json({ 
                success: true, 
                message: 'Identity verified successfully' 
            });
        } catch (error) {
            console.error('Verify identity error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Server error: ' + error.message 
            });
        }
    }

    /**
     * Reset librarian password
     * POST /api/librarian/reset-password
     */
    static async resetPassword(req, res) {
        try {
            const { employeeId, newPassword } = req.body;
            
            if (!employeeId || !newPassword) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Employee ID and new password are required' 
                });
            }
            
            if (newPassword.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Password must be at least 6 characters' 
                });
            }
            
            const hashedPassword = hashPassword(newPassword);
            
            const [result] = await pool.execute(
                `UPDATE librarians 
                 SET password = ?, 
                     password_format = 'PBKDF2',
                     password_migrated = 1,
                     force_password_change = 0,
                     password_updated_at = NOW()
                 WHERE employee_id = ? AND is_active = TRUE`,
                [hashedPassword, employeeId]
            );
            
            if (result.affectedRows === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Librarian not found or inactive' 
                });
            }
            
            res.json({ 
                success: true, 
                message: 'Password reset successfully' 
            });
        } catch (error) {
            console.error('Reset password error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Server error: ' + error.message 
            });
        }
    }

    /**
     * Get dashboard statistics
     * GET /api/librarian/statistics
     */
    static async getStatistics(req, res) {
        try {
            const [stats] = await pool.execute(`
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE is_active = 1) as activeUsers,
                    (SELECT COUNT(*) FROM books) as totalBooks,
                    (SELECT IFNULL(SUM(available_quantity), 0) FROM books) as availableBooks,
                    (SELECT COUNT(*) FROM book_requests WHERE status = 'PENDING') as pendingRequests,
                    (SELECT COUNT(*) FROM book_requests) as totalRequests,
                    (SELECT COUNT(*) FROM librarians WHERE is_active = 1) as activeLibrarians
            `);
            
            res.json({ 
                success: true, 
                data: stats[0] 
            });
        } catch (error) {
            console.error('Get statistics error:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    }

    /**
     * Get pending book requests (both BORROW and RETURN)
     * GET /api/librarian/requests/pending
     */
    static async getPendingRequests(req, res) {
        try {
            const [requests] = await pool.execute(`
                SELECT 
                    br.id,
                    br.user_id,
                    br.book_id,
                    br.request_date,
                    br.status,
                    br.request_type,
                    br.notes,
                    u.full_name as userName,
                    u.username as userUsername,
                    u.nta_level as userNtaLevel,
                    b.title as bookTitle,
                    b.author as bookAuthor,
                    b.isbn as bookIsbn,
                    b.available_quantity as availableQuantity
                FROM book_requests br
                JOIN users u ON br.user_id = u.id
                JOIN books b ON br.book_id = b.id
                WHERE br.status = 'PENDING'
                ORDER BY 
                    CASE br.request_type 
                        WHEN 'RETURN' THEN 1 
                        WHEN 'BORROW' THEN 2 
                        ELSE 3 
                    END,
                    br.request_date DESC
            `);
            
            // Format object keys matching exact SQL aliases
            const formattedRequests = requests.map(req => ({
                id: req.id,
                userName: req.userName,
                userUsername: req.userUsername,
                userNtaLevel: req.userNtaLevel,
                bookTitle: req.bookTitle,
                bookAuthor: req.bookAuthor,
                bookIsbn: req.bookIsbn,
                requestDate: req.request_date,
                requestType: req.request_type || 'BORROW',
                status: req.status,
                notes: req.notes,
                availableQuantity: req.availableQuantity
            }));
            
            res.json({ 
                success: true, 
                data: formattedRequests 
            });
        } catch (error) {
            console.error('Get pending requests error:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    }

    /**
     * Approve a book request (handles both BORROW and RETURN)
     * POST /api/librarian/requests/:id/approve
     */
    static async approveRequest(req, res) {
        const connection = await pool.getConnection();
        
        try {
            const { id } = req.params;
            const librarianId = req.user.id;
            
            await connection.beginTransaction();
            
            const [requests] = await connection.execute(
                `SELECT br.*, b.title, b.available_quantity, b.quantity 
                 FROM book_requests br
                 JOIN books b ON br.book_id = b.id
                 WHERE br.id = ? AND br.status = 'PENDING'`,
                [id]
            );
            
            if (requests.length === 0) {
                await connection.rollback();
                return res.status(404).json({ 
                    success: false, 
                    message: 'Request not found or already processed' 
                });
            }
            
            const request = requests[0];
            
            if (request.request_type === 'RETURN') {
                await connection.execute(
                    `UPDATE book_requests 
                     SET status = 'APPROVED', 
                         approved_by = ?,
                         approval_date = NOW(),
                         return_date = NOW()
                     WHERE id = ?`,
                    [librarianId, id]
                );
            } else {
                await connection.execute(
                    `UPDATE book_requests 
                     SET status = 'APPROVED', 
                         approved_by = ?,
                         approval_date = NOW(),
                         borrow_date = NOW(),
                         due_date = DATE_ADD(NOW(), INTERVAL 14 DAY)
                     WHERE id = ?`,
                    [librarianId, id]
                );
            }
            
            if (request.request_type === 'BORROW') {
                const [updateResult] = await connection.execute(
                    `UPDATE books 
                     SET available_quantity = available_quantity - 1 
                     WHERE id = ? AND available_quantity > 0`,
                    [request.book_id]
                );
                
                if (updateResult.affectedRows === 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Book is no longer available'
                    });
                }
            } else if (request.request_type === 'RETURN') {
                await connection.execute(
                    `UPDATE books 
                     SET available_quantity = available_quantity + 1 
                     WHERE id = ?`,
                    [request.book_id]
                );
            }
            
            await connection.commit();
            
            res.json({ 
                success: true, 
                message: `${request.request_type} request approved successfully`
            });
            
        } catch (error) {
            await connection.rollback();
            console.error('Approve request error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to approve request: ' + error.message 
            });
        } finally {
            connection.release();
        }
    }

    /**
     * Reject a book request
     * POST /api/librarian/requests/:id/reject
     */
    static async rejectRequest(req, res) {
        const connection = await pool.getConnection();
        
        try {
            const { id } = req.params;
            const { notes } = req.body;
            const librarianId = req.user.id;
            
            await connection.beginTransaction();
            
            const [requests] = await connection.execute(
                `SELECT * FROM book_requests WHERE id = ? AND status = 'PENDING'`,
                [id]
            );
            
            if (requests.length === 0) {
                await connection.rollback();
                return res.status(404).json({ 
                    success: false, 
                    message: 'Request not found or already processed' 
                });
            }
            
            await connection.execute(
                `UPDATE book_requests 
                 SET status = 'REJECTED', 
                     approved_by = ?, 
                     approval_date = NOW(),
                     notes = ?
                 WHERE id = ?`,
                [librarianId, notes || 'No reason provided', id]
            );
            
            await connection.commit();
            
            res.json({ 
                success: true, 
                message: 'Request rejected successfully' 
            });
            
        } catch (error) {
            await connection.rollback();
            console.error('Reject request error:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        } finally {
            connection.release();
        }
    }
}

module.exports = LibrarianController;
