const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin Messaging instance (safe fallback if firebase-admin initialized globally)
let messaging = null;
try {
    messaging = admin.messaging();
} catch (e) {
    // Messaging will be initialized when admin app is configured
}

/**
 * Helper to send push notifications using Firebase Cloud Messaging HTTP v1 API.
 *
 * type values (must match MyFirebaseMessagingService on Android):
 *   REQUEST_APPROVED | REQUEST_REJECTED | RETURN_APPROVED | RETURN_REJECTED
 */
async function sendRequestStatusNotification(userId, deviceToken, requestId, bookTitle, type) {
    if (!messaging) {
        try {
            messaging = admin.messaging();
        } catch (e) {
            console.warn('Firebase Admin messaging is not initialized. Skipping push notification.');
            return false;
        }
    }

    // Human-readable title/body depending on outcome type
    let title, body;
    switch (type) {
        case 'REQUEST_APPROVED':
            title = 'Request Approved';
            body  = `Your request for "${bookTitle}" has been approved!`;
            break;
        case 'REQUEST_REJECTED':
            title = 'Request Rejected';
            body  = `Your request for "${bookTitle}" has been rejected.`;
            break;
        case 'RETURN_APPROVED':
            title = 'Return Approved';
            body  = `Your return of "${bookTitle}" has been approved.`;
            break;
        case 'RETURN_REJECTED':
            title = 'Return Rejected';
            body  = `Your return of "${bookTitle}" has been rejected.`;
            break;
        default:
            title = 'Library Update';
            body  = `There is an update on your request for "${bookTitle}".`;
    }

    const message = {
        token: deviceToken,
        notification: { title, body },
        data: {
            type,
            requestId: String(requestId),
            // Keep data title/body populated so the foreground
            // onMessageReceived() branch can also build a notification.
            title,
            body
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'library_requests', // matches CHANNEL_ID in MyFirebaseMessagingService
                sound: 'default'
            }
        }
    };

    try {
        const response = await messaging.send(message);
        console.log('Successfully sent push notification:', response);
        return true;
    } catch (error) {
        console.error('Error sending push notification:', error);

        // Prune dead tokens so the DB stays clean
        if (
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token'
        ) {
            try {
                await pool.execute('UPDATE users SET fcm_token = NULL WHERE id = ?', [userId]);
                console.log(`Removed invalid FCM token for user ID: ${userId}`);
            } catch (dbErr) {
                console.error('Failed to remove invalid FCM token from database:', dbErr);
            }
        }
        return false;
    }
}

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
     * Update FCM Token for librarian
     * POST /api/librarian/fcm-token
     */
    static async updateFcmToken(req, res) {
        try {
            const { token } = req.body;
            if (!token) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Token required' 
                });
            }

            const librarianId = req.user.id;
            await pool.execute(
                'UPDATE librarians SET fcm_token = ? WHERE id = ?',
                [token, librarianId]
            );

            res.json({ success: true });
        } catch (error) {
            console.error('Update FCM token error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update FCM token'
            });
        }
    }

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
     * Update Librarian Profile (username, email, phone)
     * PUT /api/librarian/profile
     * Requires librarianAuth
     */
    static async updateLibrarianProfile(req, res) {
        try {
            const librarianId = req.user ? req.user.id : null;
            if (!librarianId) {
                return res.status(401).json({ success: false, message: 'Authentication required' });
            }

            const { username, email, phone } = req.body;

            if (!username && !email && !phone) {
                return res.status(400).json({ success: false, message: 'No fields to update' });
            }

            if (email) {
                const [dup] = await pool.execute(
                    'SELECT id FROM librarians WHERE email = ? AND id <> ? AND is_active = 1',
                    [email, librarianId]
                );
                if (dup.length > 0) {
                    return res.status(409).json({ success: false, message: 'Email already in use' });
                }
            }
            if (username) {
                const [dup] = await pool.execute(
                    'SELECT id FROM librarians WHERE username = ? AND id <> ? AND is_active = 1',
                    [username, librarianId]
                );
                if (dup.length > 0) {
                    return res.status(409).json({ success: false, message: 'Username already in use' });
                }
            }

            const fields = [];
            const params = [];
            if (username) { fields.push('username = ?'); params.push(username); }
            if (email)    { fields.push('email = ?');    params.push(email); }
            if (phone)    { fields.push('phone = ?');    params.push(phone); }

            params.push(librarianId);
            await pool.execute(
                `UPDATE librarians SET ${fields.join(', ')} WHERE id = ? AND is_active = 1`,
                params
            );

            const [rows] = await pool.execute(
                `SELECT id, username, full_name, employee_id, email, phone
                   FROM librarians WHERE id = ?`,
                [librarianId]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Librarian not found' });
            }

            const lib = rows[0];
            return res.json({
                success: true,
                message: 'Profile updated successfully',
                librarian: {
                    id: lib.id,
                    username: lib.username,
                    fullName: lib.full_name,
                    employeeId: lib.employee_id,
                    email: lib.email,
                    phone: lib.phone || 'N/A'
                }
            });
        } catch (error) {
            console.error('Update librarian profile error:', error);
            return res.status(500).json({ success: false, message: 'Failed to update profile' });
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
                    u.level AS userNtaLevel,
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
                `SELECT br.*, b.title AS book_title 
                 FROM book_requests br 
                 JOIN books b ON br.book_id = b.id 
                 WHERE br.id = ? AND br.status = 'PENDING'`,
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

            // Fire-and-forget push notification post-transaction
            (async () => {
                try {
                    const [userRows] = await pool.execute(
                        'SELECT fcm_token FROM users WHERE id = ?',
                        [request.user_id]
                    );
                    if (userRows && userRows.length > 0 && userRows[0].fcm_token) {
                        const type = request.request_type === 'RETURN'
                            ? 'RETURN_APPROVED'
                            : 'REQUEST_APPROVED';

                        await sendRequestStatusNotification(
                            request.user_id,
                            userRows[0].fcm_token,
                            requestId,
                            request.book_title || 'Requested Book',
                            type
                        );
                    }
                } catch (notifErr) {
                    console.error('Failed to trigger approval notification:', notifErr);
                }
            })();

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

            // Join books so we can include the title in the push notification
            const [requests] = await pool.execute(
                `SELECT br.*, b.title AS book_title
                   FROM book_requests br
                   JOIN books b ON br.book_id = b.id
                  WHERE br.id = ? AND br.status = 'PENDING'`,
                [requestId]
            );

            if (!requests || requests.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Pending request not found'
                });
            }

            const request = requests[0];

            await pool.execute(
                `UPDATE book_requests 
                 SET status = 'REJECTED', notes = ?, remark = ?, remark_by = ?, remark_date = NOW() 
                 WHERE id = ?`,
                [finalReason, finalReason, librarianId, requestId]
            );

            // Fire-and-forget push notification after successful reject
            (async () => {
                try {
                    const [userRows] = await pool.execute(
                        'SELECT fcm_token FROM users WHERE id = ?',
                        [request.user_id]
                    );
                    if (userRows && userRows.length > 0 && userRows[0].fcm_token) {
                        const type = request.request_type === 'RETURN'
                            ? 'RETURN_REJECTED'
                            : 'REQUEST_REJECTED';

                        await sendRequestStatusNotification(
                            request.user_id,
                            userRows[0].fcm_token,
                            requestId,
                            request.book_title || 'Requested Book',
                            type
                        );
                    }
                } catch (notifErr) {
                    console.error('Failed to trigger rejection notification:', notifErr);
                }
            })();

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
     *
     * FIX: Added remark_by, remark_date, and librarian full_name (remarkByName)
     * so Android can display and enforce immutability of remarks.
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
                    u.level AS userNtaLevel,
                    br.book_id AS bookId,
                    b.title AS bookTitle,
                    b.author AS bookAuthor,
                    b.isbn AS bookIsbn,
                    br.request_type AS requestType,
                    br.status,
                    br.notes,
                    br.remark,
                    br.remark_by AS remarkBy,
                    br.remark_date AS remarkDate,
                    rl.full_name AS remarkByName,
                    br.request_date AS requestDate,
                    br.approval_date AS approvalDate,
                    br.borrow_date AS borrowDate,
                    br.due_date AS dueDate,
                    br.return_date AS returnDate,
                    pl.full_name AS librarianName
                FROM book_requests br
                JOIN users u ON br.user_id = u.id
                JOIN books b ON br.book_id = b.id
                LEFT JOIN librarians rl ON br.remark_by = rl.id
                LEFT JOIN librarians pl ON br.approved_by = pl.id
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

            // Inline LIMIT as a validated integer literal (safe — value is a
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
     *
     * FIX: 
     * - Enforces immutability: returns 409 Conflict if a remark already exists.
     * - Returns requestId, remarkByName (full name), remarkDate in the payload
     *   so the Android client can update the list item inline.
     */
    static async addRequestRemark(req, res) {
        try {
            const requestId = req.params.id;
            const { remark } = req.body;
            const librarianId = req.user ? req.user.id : null;

            if (!remark || String(remark).trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Remark content is required'
                });
            }

            if (String(remark).length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'Remark must be 1000 characters or fewer'
                });
            }

            // Verify the request exists and check for an existing immutable remark
            const [existing] = await pool.execute(
                `SELECT id, remark FROM book_requests WHERE id = ?`,
                [requestId]
            );

            if (!existing || existing.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Request not found'
                });
            }

            const currentRemark = existing[0].remark;
            if (currentRemark !== null && String(currentRemark).trim() !== '') {
                // 409 Conflict — remark is final and cannot be modified
                return res.status(409).json({
                    success: false,
                    message: 'This remark is final and cannot be modified'
                });
            }

            await pool.execute(
                `UPDATE book_requests 
                 SET remark = ?, remark_by = ?, remark_date = NOW() 
                 WHERE id = ?`,
                [String(remark).trim(), librarianId, requestId]
            );

            // Fetch the librarian's full name for the response
            let librarianFullName = 'Librarian';
            if (librarianId) {
                const [libRows] = await pool.execute(
                    `SELECT full_name, username FROM librarians WHERE id = ?`,
                    [librarianId]
                );
                if (libRows && libRows.length > 0) {
                    librarianFullName = libRows[0].full_name || libRows[0].username || 'Librarian';
                }
            }

            // Fetch the authoritative remark_date back from the DB so client
            // and server timestamps match exactly
            const [freshRows] = await pool.execute(
                `SELECT remark, remark_date FROM book_requests WHERE id = ?`,
                [requestId]
            );
            const freshRemark = freshRows && freshRows[0] ? freshRows[0].remark : String(remark).trim();
            const freshRemarkDate = freshRows && freshRows[0] && freshRows[0].remark_date
                ? freshRows[0].remark_date
                : new Date().toISOString();

            res.json({
                success: true,
                message: 'Remark added successfully',
                data: {
                    requestId: parseInt(requestId, 10),
                    remark: freshRemark,
                    remarkByName: librarianFullName,
                    remarkDate: freshRemarkDate
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
            const employeeId = req.body.employeeId || req.body.employee_id || null;
            const fullName = req.body.fullName || req.body.full_name || req.body.username || null;
            const email = req.body.email || null;

            if (!employeeId || !fullName || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'Employee ID, Full Name, and Email are required.'
                });
            }

            // Query matching employee_id, email, and either full_name OR username
            const [rows] = await pool.execute(
                `SELECT id FROM librarians 
                 WHERE employee_id = ? 
                   AND email = ? 
                   AND (full_name = ? OR username = ?) 
                   AND is_active = 1`,
                [employeeId, email, fullName, fullName]
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

    /**
     * Get borrow trend analytics for charts
     * GET /api/librarian/analytics/trends?days=7
     */
    static async getBorrowTrends(req, res) {
        try {
            // Clamp days between 7 and 90 for safety
            let days = parseInt(req.query.days, 10);
            if (isNaN(days) || days < 1) days = 7;
            if (days > 90) days = 90;

            // 1. Borrows per day (only APPROVED borrow requests)
            const [dailyRows] = await pool.execute(`
                SELECT 
                    DATE(request_date) AS date,
                    COUNT(*) AS count
                FROM book_requests
                WHERE request_type = 'BORROW'
                  AND status IN ('APPROVED', 'COMPLETED', 'RETURNED')
                  AND request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY DATE(request_date)
                ORDER BY date ASC
            `, [days]);

            // 2. Requests by type (BORROW vs RETURN vs RESERVE)
            const [typeRows] = await pool.execute(`
                SELECT 
                    request_type AS type,
                    COUNT(*) AS count
                FROM book_requests
                WHERE request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY request_type
            `, [days]);

            // 3. Top 5 most borrowed books
            const [topBooks] = await pool.execute(`
                SELECT 
                    b.title AS title,
                    b.author AS author,
                    COUNT(*) AS count
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                WHERE br.request_type = 'BORROW'
                  AND br.status IN ('APPROVED', 'COMPLETED', 'RETURNED')
                  AND br.request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY b.id, b.title, b.author
                ORDER BY count DESC
                LIMIT 5
            `, [days]);

            // 4. Status distribution
            const [statusRows] = await pool.execute(`
                SELECT 
                    status,
                    COUNT(*) AS count
                FROM book_requests
                WHERE request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY status
            `, [days]);

            res.json({
                success: true,
                data: {
                    days,
                    dailyBorrows: dailyRows.map(r => ({
                        date: r.date,
                        count: Number(r.count)
                    })),
                    byType: typeRows.map(r => ({
                        type: r.type,
                        count: Number(r.count)
                    })),
                    topBooks: topBooks.map(r => ({
                        title: r.title,
                        author: r.author,
                        count: Number(r.count)
                    })),
                    byStatus: statusRows.map(r => ({
                        status: r.status,
                        count: Number(r.count)
                    }))
                }
            });
        } catch (error) {
            console.error('Get borrow trends error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve analytics'
            });
        }
    }
}

module.exports = LibrarianController;
