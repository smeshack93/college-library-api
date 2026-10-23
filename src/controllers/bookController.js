// controllers/bookController.js
const Book = require('../models/Book');
const { pool } = require('../config/database');
const admin = require('firebase-admin');

// Global institution bucket — books tagged exactly 'General' are visible
// to every institution. No case normalization: matches the literal string.
const GLOBAL_INSTITUTION = 'General';

// Where web-push notifications should click through to.
// Matches the librarianController convention.
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-web-app.example.com';

class BookController {

    /**
     * Get all available books
     * GET /api/books
     */
    static async getAllBooks(req, res) {
        try {
            const institution = req.user && req.user.institution ? req.user.institution : null;

            if (!institution) {
                return res.json({
                    success: true,
                    count: 0,
                    data: []
                });
            }

            const [rows] = await pool.execute(
                `SELECT * FROM books
                  WHERE quantity > 0
                    AND institution IS NOT NULL
                    AND (institution = ? OR institution = ?)
                  ORDER BY title`,
                [institution, GLOBAL_INSTITUTION]
            );

            res.json({
                success: true,
                count: rows.length,
                data: rows
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
            const studentInstitution = req.user && req.user.institution ? req.user.institution : null;
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

            if (!studentInstitution) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has no institution assigned'
                });
            }
            const bookInst = book.institution;
            if (!bookInst || (bookInst !== studentInstitution && bookInst !== GLOBAL_INSTITUTION)) {
                return res.status(403).json({
                    success: false,
                    message: 'This book is not available for your institution'
                });
            }

            if (requestType === 'BORROW' && book.available_quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Book is currently out of stock'
                });
            }

            if (requestType === 'BORROW') {
                const [activeBorrow] = await pool.execute(
                    `SELECT id, status, request_type
                       FROM book_requests
                      WHERE user_id = ?
                        AND book_id = ?
                        AND (
                              (request_type = 'BORROW' AND status IN ('PENDING', 'APPROVED'))
                           OR (request_type = 'RETURN' AND status = 'PENDING')
                        )
                      LIMIT 1`,
                    [userId, bookId]
                );

                if (activeBorrow.length > 0) {
                    const row = activeBorrow[0];
                    let reason;
                    if (row.request_type === 'RETURN') {
                        reason = 'You already submitted a return for this book. ' +
                                 'Please wait for the librarian to process it before borrowing again.';
                    } else if (row.status === 'APPROVED') {
                        reason = 'You already have this book borrowed. ' +
                                 'Please return it before borrowing it again.';
                    } else {
                        reason = 'You already have a pending request for this book.';
                    }
                    return res.status(400).json({
                        success: false,
                        message: reason
                    });
                }
            }

            const [result] = await pool.execute(
                `INSERT INTO book_requests (user_id, book_id, request_type, status, request_date)
                 VALUES (?, ?, ?, 'PENDING', UTC_TIMESTAMP())`,
                [userId, bookId, requestType]
            );

            const newRequestId = result.insertId;

            try {
                const [librarians] = await pool.execute(
                    "SELECT id, fcm_token, fcm_token_web FROM librarians " +
                    "WHERE is_active = 1 " +
                    "AND ( (fcm_token IS NOT NULL AND fcm_token <> '') " +
                    "   OR (fcm_token_web IS NOT NULL AND fcm_token_web <> '') ) " +
                    "AND (institution = ? OR institution = ?)",
                    [bookInst, GLOBAL_INSTITUTION]
                );

                const tokens = [];
                for (const l of librarians) {
                    if (l.fcm_token)     tokens.push(l.fcm_token);
                    if (l.fcm_token_web) tokens.push(l.fcm_token_web);
                }

                if (tokens.length > 0) {
                    const title = 'New Book Request';
                    const body  = `A student requested "${book.title || 'a book'}".`;

                    const messagePayload = {
                        tokens: tokens,
                        notification: { title, body },
                        data: {
                            type: 'NEW_REQUEST',
                            requestId: String(newRequestId),
                            title,
                            body
                        },
                        android: {
                            priority: 'high',
                            notification: {
                                channelId: 'library_requests',
                                sound: 'default'
                            }
                        },
                        webpush: {
                            notification: {
                                icon: '/static/images/kctm.png',
                                badge: '/static/images/kctm.png',
                                click_action: WEB_APP_URL
                            },
                            fcmOptions: {
                                link: WEB_APP_URL
                            }
                        }
                    };

                    if (typeof admin.messaging().sendEachForMulticast === 'function') {
                        await admin.messaging().sendEachForMulticast(messagePayload);
                    } else if (typeof admin.messaging().sendMulticast === 'function') {
                        await admin.messaging().sendMulticast(messagePayload);
                    }
                }
            } catch (notifErr) {
                console.error('Failed to send push notification to librarians:', notifErr);
            }

            res.status(201).json({
                success: true,
                message: 'Book request submitted successfully',
                requestId: newRequestId
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
     * Request to return a borrowed book
     * POST /api/books/return
     */
    static async requestReturn(req, res) {
        try {
            const userId = req.user.id;
            const studentInstitution = req.user && req.user.institution ? req.user.institution : null;
            const { bookId, requestId } = req.body;

            if (!bookId || !requestId) {
                return res.status(400).json({
                    success: false,
                    message: 'bookId and requestId are required'
                });
            }

            const [bookRows] = await pool.execute(
                `SELECT id, institution FROM books WHERE id = ?`,
                [bookId]
            );
            if (!bookRows.length) {
                return res.status(404).json({ success: false, message: 'Book not found' });
            }
            const bookInst = bookRows[0].institution;
            if (!studentInstitution) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has no institution assigned'
                });
            }
            if (!bookInst || (bookInst !== studentInstitution && bookInst !== GLOBAL_INSTITUTION)) {
                return res.status(403).json({
                    success: false,
                    message: 'This book is not available for your institution'
                });
            }

            const [borrowRequests] = await pool.execute(
                `SELECT id, book_id, status, request_type, borrow_date, due_date
                   FROM book_requests
                  WHERE id = ? AND user_id = ? AND status = 'APPROVED'`,
                [requestId, userId]
            );

            if (borrowRequests.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Borrow record not found or not approved'
                });
            }

            const borrowRequest = borrowRequests[0];

            if (borrowRequest.request_type !== 'BORROW') {
                return res.status(400).json({
                    success: false,
                    message: 'This is not a borrow record'
                });
            }

            const [existingReturn] = await pool.execute(
                `SELECT id FROM book_requests
                  WHERE user_id = ? AND book_id = ?
                    AND request_type = 'RETURN' AND status = 'PENDING'`,
                [userId, bookId]
            );
            if (existingReturn.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'You already have a pending return request for this book'
                });
            }

            const [approvedReturn] = await pool.execute(
                `SELECT id FROM book_requests
                  WHERE user_id = ? AND book_id = ?
                    AND request_type = 'RETURN' AND status IN ('APPROVED', 'RETURNED')`,
                [userId, bookId]
            );
            if (approvedReturn.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'This book has already been returned'
                });
            }

            if (borrowRequest.status === 'COMPLETED' || borrowRequest.status === 'RETURNED') {
                return res.status(400).json({
                    success: false,
                    message: 'This book has already been returned'
                });
            }

            // Enforce librarian remark BEFORE allowing return.
            const [remarkCheck] = await pool.execute(
                `SELECT remark FROM book_requests WHERE id = ?`,
                [requestId]
            );
            const hasRemark = remarkCheck.length > 0
                && remarkCheck[0].remark !== null
                && String(remarkCheck[0].remark).trim() !== '';
            if (!hasRemark) {
                return res.status(400).json({
                    success: false,
                    message: 'This record has no librarian remark yet. Please contact ' +
                             'the librarian to add a remark on this borrow before ' +
                             'requesting a return.'
                });
            }

            // Copy borrow_date & due_date from parent BORROW row.
            const [result] = await pool.execute(
                `INSERT INTO book_requests
                    (user_id, book_id, request_type, status, request_date,
                     related_request_id, notes, borrow_date, due_date)
                  VALUES (?, ?, 'RETURN', 'PENDING', UTC_TIMESTAMP(), ?, ?, ?, ?)`,
                [
                    userId,
                    bookId,
                    requestId,
                    'Return request for borrowed book',
                    borrowRequest.borrow_date || null,
                    borrowRequest.due_date    || null
                ]
            );

            console.log(`📤 Return request created: user=${userId}, book=${bookId}, parent=${requestId}`);

            res.status(201).json({
                success: true,
                message: 'Return request submitted successfully',
                requestId: result.insertId
            });
        } catch (error) {
            console.error('Error requesting return:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to process return request: ' + error.message
            });
        }
    }

    /**
     * Get all borrow requests for a specific user
     * GET /api/books/users/:id/borrows
     */
    static async getUserBorrows(req, res) {
        try {
            const userId = req.params.id || req.params.userId;

            const [users] = await pool.execute(
                'SELECT id, full_name FROM users WHERE id = ?',
                [userId]
            );
            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const [rows] = await pool.execute(`
                SELECT
                    br.id              as requestId,
                    br.book_id         as bookId,
                    br.request_date    as requestDate,
                    br.status,
                    br.request_type    as requestType,
                    br.due_date        as dueDate,
                    br.borrow_date     as borrowDate,
                    br.approval_date   as approvalDate,
                    br.notes,
                    br.related_request_id,
                    b.title            as bookTitle,
                    b.author           as bookAuthor,
                    b.isbn,
                    b.category,
                    b.level            as ntaLevel,
                    l.full_name        as librarianName,
                    l.phone            as librarianPhone,
                    l.email            as librarianEmail,
                    br.remark,
                    br.remark_by,
                    br.remark_date,
                    rl.full_name       as remarkByName,
                    parent.due_date    as parentDueDate,
                    parent.borrow_date as parentBorrowDate,
                    (SELECT COUNT(*) FROM book_requests
                     WHERE (related_request_id = br.id OR (book_id = br.book_id AND user_id = br.user_id))
                       AND request_type = 'RETURN' AND status IN ('APPROVED','RETURNED')) as has_approved_return,
                    (SELECT COUNT(*) FROM book_requests
                     WHERE (related_request_id = br.id OR (book_id = br.book_id AND user_id = br.user_id))
                       AND request_type = 'RETURN' AND status = 'PENDING') as has_pending_return
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                LEFT JOIN book_requests parent ON br.related_request_id = parent.id
                LEFT JOIN librarians l  ON br.approved_by = l.id
                LEFT JOIN librarians rl ON br.remark_by   = rl.id
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
                borrowDate: row.borrowDate || row.parentBorrowDate || row.requestDate,
                dueDate:    row.dueDate    || row.parentDueDate    || null,
                category: row.category || 'General',
                ntaLevel: row.ntaLevel || 'N/A',
                requestType: row.requestType || 'BORROW',
                notes: row.notes || '',
                librarianName:  row.librarianName  || null,
                librarianPhone: row.librarianPhone || null,
                librarianEmail: row.librarianEmail || null,
                relatedRequestId: row.related_request_id || 0,
                hasApprovedReturn: row.has_approved_return > 0,
                hasPendingReturn:  row.has_pending_return  > 0,
                remark: row.remark || null,
                remarkBy: row.remark_by || null,
                remarkByName: row.remarkByName || null,
                remarkDate: row.remark_date || null
            }));

            res.json({ success: true, count: formattedBorrows.length, data: formattedBorrows });
        } catch (error) {
            console.error('Error fetching user borrows:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch borrow requests: ' + error.message
            });
        }
    }

    /**
     * Get borrow requests for the current authenticated user
     * GET /api/books/my-borrows
     */
    static async getMyBorrows(req, res) {
        try {
            if (!req.user || !req.user.id) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }
            const userId = req.user.id;

            const [rows] = await pool.execute(`
                SELECT
                    br.id              as requestId,
                    br.book_id         as bookId,
                    br.request_date    as requestDate,
                    br.status,
                    br.request_type,
                    br.due_date        as dueDate,
                    br.borrow_date     as borrowDate,
                    br.approval_date   as approvalDate,
                    br.notes,
                    br.related_request_id,
                    b.title            as bookTitle,
                    b.author           as bookAuthor,
                    b.isbn,
                    b.category,
                    b.level            as ntaLevel,
                    l.full_name        as librarianName,
                    l.phone            as librarianPhone,
                    l.email            as librarianEmail,
                    br.remark,
                    br.remark_by,
                    br.remark_date,
                    rl.full_name       as remarkByName,
                    parent.due_date    as parentDueDate,
                    parent.borrow_date as parentBorrowDate,
                    (SELECT COUNT(*) FROM book_requests
                     WHERE (related_request_id = br.id OR (book_id = br.book_id AND user_id = br.user_id))
                       AND request_type = 'RETURN' AND status IN ('APPROVED','RETURNED')) as has_approved_return,
                    (SELECT COUNT(*) FROM book_requests
                     WHERE (related_request_id = br.id OR (book_id = br.book_id AND user_id = br.user_id))
                       AND request_type = 'RETURN' AND status = 'PENDING') as has_pending_return
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                LEFT JOIN book_requests parent ON br.related_request_id = parent.id
                LEFT JOIN librarians l  ON br.approved_by = l.id
                LEFT JOIN librarians rl ON br.remark_by   = rl.id
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
                borrowDate: row.borrowDate || row.parentBorrowDate || row.requestDate,
                dueDate:    row.dueDate    || row.parentDueDate    || null,
                category: row.category || 'General',
                ntaLevel: row.ntaLevel || 'N/A',
                requestType: row.request_type || 'BORROW',
                notes: row.notes || '',
                relatedRequestId: row.related_request_id || 0,
                hasApprovedReturn: row.has_approved_return > 0,
                hasPendingReturn:  row.has_pending_return  > 0,
                librarianName:  row.librarianName  || null,
                librarianPhone: row.librarianPhone || null,
                librarianEmail: row.librarianEmail || null,
                remark: row.remark || null,
                remarkBy: row.remark_by || null,
                remarkByName: row.remarkByName || null,
                remarkDate: row.remark_date || null
            }));

            res.json({ success: true, count: formattedBorrows.length, data: formattedBorrows });
        } catch (error) {
            console.error('Error fetching my borrows:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch borrow requests: ' + error.message
            });
        }
    }

    // NOTE: approveRequest and rejectRequest were removed from this file.
    // They were never mounted by routes/books.js — the live handlers live
    // in controllers/librarianController.js and are mounted at
    // /api/librarian/requests/:id/approve and /:id/reject.
}

module.exports = BookController;
