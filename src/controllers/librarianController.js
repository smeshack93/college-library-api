const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { verifyPassword, hashPassword } = require('../utils/passwordUtils');

class LibrarianController {

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
            
            res.json({ 
                success: true, 
                data: requests 
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
}

module.exports = LibrarianController;
