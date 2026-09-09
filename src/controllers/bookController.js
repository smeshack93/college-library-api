// src/controllers/bookController.js
const Book = require('../models/Book');
const pool = require('../config/database');

class BookController {
    /**
     * Get all available books
     * GET /api/books
     */
    static async getAllBooks(req, res) {
        try {
            const books = await Book.findAll();
            res.json({
                success: true,
                count: books.length,
                data: books
            });
        } catch (error) {
            console.error('Error fetching books:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch books: ' + error.message
            });
        }
    }

    /**
     * Get single book by ID
     * GET /api/books/:id
     */
    static async getBookById(req, res) {
        try {
            const { id } = req.params;
            const book = await Book.findById(id);

            if (!book) {
                return res.status(404).json({
                    success: false,
                    message: 'Book not found'
                });
            }

            res.json({
                success: true,
                data: book
            });
        } catch (error) {
            console.error('Error fetching book:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch book: ' + error.message
            });
        }
    }

    /**
     * Submit a request for a book (handles both BORROW and RETURN)
     * POST /api/books/request
     */
    static async requestBook(req, res) {
        try {
            const userId = req.user.id;
            const { bookId, requestType = 'BORROW' } = req.body;

            if (!bookId) {
                return res.status(400).json({
                    success: false,
                    message: 'bookId is required'
                });
            }

            const book = await Book.findById(bookId);
            if (!book) {
                return res.status(404).json({
                    success: false,
                    message: 'Book not found'
                });
            }

            if (requestType === 'BORROW' && book.available_quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Book is currently out of stock'
                });
            }

            // Check if user already has a pending request for this book
            const [existing] = await pool.execute(
                `SELECT id FROM book_requests 
                 WHERE user_id = ? AND book_id = ? AND status = 'PENDING'`,
                [userId, bookId]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'You already have a pending request for this book'
                });
            }

            const [result] = await pool.execute(
                `INSERT INTO book_requests (user_id, book_id, request_type, status, request_date)
                 VALUES (?, ?, ?, 'PENDING', NOW())`,
                [userId, bookId, requestType]
            );

            res.status(201).json({
                success: true,
                message: 'Book request submitted successfully',
                requestId: result.insertId
            });
        } catch (error) {
            console.error('Error requesting book:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to process request: ' + error.message
            });
        }
    }

    /**
     * Get all borrow requests for a specific user
     * GET /api/books/user/:id/borrows
     */
    static async getUserBorrows(req, res) {
        try {
            const userId = req.params.id;
            
            console.log(`🔍 Fetching borrows for user ID: ${userId}`);
            console.log(`👤 Requesting user: ${req.user?.id}, Type: ${req.user?.type}`);
            
            // Verify the requesting user is the same as the userId (or is a librarian)
            if (req.user.type !== 'LIBRARIAN' && req.user.id !== parseInt(userId)) {
                console.log(`❌ Unauthorized: User ${req.user.id} trying to access ${userId}`);
                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized to view this user\'s borrows'
                });
            }

            // Check if user exists
            const [users] = await pool.execute(
                'SELECT id, full_name FROM users WHERE id = ?',
                [userId]
            );
            
            if (users.length === 0) {
                console.log(`❌ User ${userId} not found`);
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }
            
            console.log(`✅ User found: ${users[0].full_name}`);

            // Get all borrow requests for this user
            const [rows] = await pool.execute(`
                SELECT 
                    br.id as requestId,
                    br.book_id as bookId,
                    br.request_date as requestDate,
                    br.status,
                    br.request_type,
                    br.due_date as dueDate,
                    br.borrow_date as borrowDate,
                    br.approval_date as approvalDate,
                    br.notes,
                    b.title as bookTitle,
                    b.author as bookAuthor,
                    b.isbn,
                    b.category,
                    b.nta_level as ntaLevel,
                    l.full_name as librarianName
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                LEFT JOIN librarians l ON br.approved_by = l.id
                WHERE br.user_id = ?
                ORDER BY br.request_date DESC
            `, [userId]);

            console.log(`📚 Found ${rows.length} borrow requests for user ${userId}`);

            const formattedBorrows = rows.map(row => ({
                requestId: row.requestId,
                bookId: row.bookId,
                bookTitle: row.bookTitle || 'Unknown Book',
                bookAuthor: row.bookAuthor || 'Unknown Author',
                isbn: row.isbn || 'N/A',
                status: row.status || 'PENDING',
                requestDate: row.requestDate,
                borrowDate: row.borrowDate || row.requestDate,
                dueDate: row.dueDate || null,
                category: row.category || 'General',
                ntaLevel: row.ntaLevel || 'N/A',
                requestType: row.request_type || 'BORROW',
                notes: row.notes || '',
                librarianName: row.librarianName || null
            }));

            res.json({
                success: true,
                count: formattedBorrows.length,
                data: formattedBorrows
            });

        } catch (error) {
            console.error('Error fetching user borrows:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch borrow requests: ' + error.message
            });
        }
    }

    /**
     * Get borrow requests for the current user
     * GET /api/books/my-borrows
     */
    static async getMyBorrows(req, res) {
        try {
            if (!req.user || !req.user.id) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const userId = req.user.id;

            const [rows] = await pool.execute(`
                SELECT 
                    br.id as requestId,
                    br.book_id as bookId,
                    br.request_date as requestDate,
                    br.status,
                    br.request_type,
                    br.due_date as dueDate,
                    br.borrow_date as borrowDate,
                    b.title as bookTitle,
                    b.author as bookAuthor,
                    b.isbn,
                    b.category,
                    b.nta_level as ntaLevel
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                WHERE br.user_id = ?
                ORDER BY br.request_date DESC
            `, [userId]);

            const formattedBorrows = rows.map(row => ({
                requestId: row.requestId,
                bookId: row.bookId,
                bookTitle: row.bookTitle || 'Unknown Book',
                bookAuthor: row.bookAuthor || 'Unknown Author',
                isbn: row.isbn || 'N/A',
                status: row.status || 'PENDING',
                requestDate: row.requestDate,
                borrowDate: row.borrowDate || row.requestDate,
                dueDate: row.dueDate || null,
                category: row.category || 'General',
                ntaLevel: row.ntaLevel || 'N/A',
                requestType: row.request_type || 'BORROW'
            }));

            res.json({
                success: true,
                count: formattedBorrows.length,
                data: formattedBorrows
            });

        } catch (error) {
            console.error('Error fetching my borrows:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch borrow requests: ' + error.message
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
            const { notes = '' } = req.body;
            
            console.log(`📌 Approving request ID: ${id} by librarian: ${librarianId}`);
            
            await connection.beginTransaction();
            
            // Get the request details with book info
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
            console.log(`📌 Request Type: ${request.request_type}`);
            
            let actionMessage = '';
            
            if (request.request_type === 'BORROW') {
                // Update borrow request status & set due dates
                await connection.execute(
                    `UPDATE book_requests 
                     SET status = 'APPROVED', 
                         approved_by = ?, 
                         approval_date = NOW(),
                         borrow_date = NOW(),
                         due_date = DATE_ADD(NOW(), INTERVAL 14 DAY),
                         notes = ?
                     WHERE id = ?`,
                    [librarianId, notes, id]
                );

                // Decrease available quantity for borrow
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
                        message: 'Book is no longer available in stock'
                    });
                }
                actionMessage = 'Borrow request approved';
                
            } else if (request.request_type === 'RETURN') {
                // Mark request as RETURNED
                await connection.execute(
                    `UPDATE book_requests 
                     SET status = 'RETURNED', 
                         approved_by = ?, 
                         approval_date = NOW(),
                         return_date = NOW(),
                         notes = ?
                     WHERE id = ?`,
                    [librarianId, notes, id]
                );

                // Increase available quantity back to library stock
                await connection.execute(
                    `UPDATE books 
                     SET available_quantity = available_quantity + 1 
                     WHERE id = ?`,
                    [request.book_id]
                );
                actionMessage = 'Return request approved';
            } else {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Invalid request type: ${request.request_type}`
                });
            }
            
            await connection.commit();
            
            // Get updated book quantity
            const [updatedBooks] = await pool.execute(
                'SELECT available_quantity FROM books WHERE id = ?',
                [request.book_id]
            );
            const newQuantity = updatedBooks.length > 0 ? updatedBooks[0].available_quantity : 'unknown';
            
            res.json({ 
                success: true, 
                message: `${actionMessage} successfully`,
                data: {
                    requestId: id,
                    requestType: request.request_type,
                    newAvailableQuantity: newQuantity
                }
            });
            
        } catch (error) {
            await connection.rollback();
            console.error('❌ Approve request error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to approve request: ' + error.message 
            });
        } finally {
            connection.release();
        }
    }

    /**
     * Reject a book request (handles both BORROW and RETURN)
     * POST /api/librarian/requests/:id/reject
     */
    static async rejectRequest(req, res) {
        try {
            const { id } = req.params;
            const librarianId = req.user.id;
            const { notes } = req.body;

            if (!notes || notes.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Rejection reason (notes) is required'
                });
            }

            const [result] = await pool.execute(
                `UPDATE book_requests 
                 SET status = 'REJECTED', 
                     approved_by = ?, 
                     approval_date = NOW(),
                     notes = ?
                 WHERE id = ? AND status = 'PENDING'`,
                [librarianId, notes, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found or already processed'
                });
            }

            res.json({
                success: true,
                message: 'Request rejected successfully'
            });

        } catch (error) {
            console.error('❌ Reject request error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to reject request: ' + error.message
            });
        }
    }
}

module.exports = BookController;
