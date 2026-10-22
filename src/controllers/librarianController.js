const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const admin = require('firebase-admin');
const LoginLockout = require('../utils/loginLockout');

const GLOBAL_INSTITUTION = 'General';

let messaging = null;
try {
    messaging = admin.messaging();
} catch (e) { }

async function sendRequestStatusNotification(userId, deviceToken, requestId, bookTitle, type) {
    if (!messaging) {
        try { messaging = admin.messaging(); } catch (e) { return false; }
    }

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
        data: { type, requestId: String(requestId), title, body },
        android: {
            priority: 'high',
            notification: { channelId: 'library_requests', sound: 'default' }
        }
    };

    try {
        await messaging.send(message);
        return true;
    } catch (error) {
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            try {
                await pool.execute('UPDATE users SET fcm_token = NULL WHERE id = ?', [userId]);
            } catch (dbErr) { }
        }
        return false;
    }
}

function verifyPbkdf2Password(password, storedHash) {
    try {
        const parts = storedHash.split(':');
        if (parts.length !== 4 || parts[0] !== 'PBKDF2') return false;
        const iterations = parseInt(parts[1], 10);
        const salt = Buffer.from(parts[2], 'base64');
        const originalHash = Buffer.from(parts[3], 'base64');
        const derivedHash = crypto.pbkdf2Sync(password, salt, iterations, originalHash.length, 'sha256');
        return crypto.timingSafeEqual(originalHash, derivedHash);
    } catch (err) { return false; }
}

async function verifyPassword(inputPassword, librarian) {
    const storedHash = librarian.password;
    if (!storedHash) return false;
    if (storedHash.startsWith('PBKDF2:') || librarian.password_format === 'PBKDF2') {
        return verifyPbkdf2Password(inputPassword, storedHash);
    }
    return await bcrypt.compare(inputPassword, storedHash);
}

class LibrarianController {

    static async updateFcmToken(req, res) {
        try {
            const { token } = req.body;
            if (!token) return res.status(400).json({ success: false, error: 'Token required' });
            const librarianId = req.user.id;
            await pool.execute('UPDATE librarians SET fcm_token = ? WHERE id = ?', [token, librarianId]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to update FCM token' });
        }
    }

    static async getProfile(req, res) {
        try {
            const librarianId = req.user.id;
            const [rows] = await pool.execute(
                `SELECT id, username, full_name, employee_id, email, phone, institution
                    FROM librarians WHERE id = ? AND is_active = 1`,
                [librarianId]
            );
            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Librarian not found' });
            }
            res.json({
                success: true,
                librarian: {
                    id: rows[0].id,
                    username: rows[0].username,
                    fullName: rows[0].full_name,
                    employeeId: rows[0].employee_id,
                    email: rows[0].email,
                    phone: rows[0].phone || "N/A",
                    institution: rows[0].institution || ""
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to retrieve profile information' });
        }
    }

    // ---------------------------------------------------------------
    // NEW: Update the currently logged-in LIBRARIAN profile.
    // PUT /api/librarian/profile
    // Body: { username?, email?, phone? }
    //
    // Full Name, Employee ID, and NTA Level are intentionally NOT
    // editable here — they are identity fields managed by the admin
    // and mapped to the Android UI's `applyRoleVisibility()` which
    // hides those rows for librarians on the Edit Profile screen.
    // ---------------------------------------------------------------
    static async updateProfile(req, res) {
        try {
            const librarianId = req.user && req.user.id;
            if (!librarianId) {
                return res.status(401).json({ success: false, message: 'Not authenticated' });
            }

            const { username, email, phone } = req.body || {};

            const fields = [];
            const values = [];

            if (username !== undefined && username !== null && String(username).trim() !== '') {
                fields.push('username = ?');
                values.push(String(username).trim());
            }
            if (email !== undefined && email !== null && String(email).trim() !== '') {
                fields.push('email = ?');
                values.push(String(email).trim());
            }
            if (phone !== undefined && phone !== null) {
                fields.push('phone = ?');
                const trimmed = String(phone).trim();
                values.push(trimmed === '' ? null : trimmed);
            }

            if (fields.length === 0) {
                return res.status(400).json({ success: false, message: 'No changes to save' });
            }

            values.push(librarianId);

            try {
                await pool.execute(
                    `UPDATE librarians SET ${fields.join(', ')} WHERE id = ? AND is_active = 1`,
                    values
                );
            } catch (e) {
                if (e && e.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({
                        success: false,
                        message: 'Username or email already in use'
                    });
                }
                throw e;
            }

            const [rows] = await pool.execute(
                `SELECT id, username, full_name, employee_id, email, phone, institution
                   FROM librarians WHERE id = ? AND is_active = 1`,
                [librarianId]
            );
            const lib = rows[0];
            if (!lib) {
                return res.status(404).json({ success: false, message: 'Librarian not found' });
            }

            return res.json({
                success: true,
                message: 'Profile updated successfully',
                librarian: {
                    id: lib.id,
                    username: lib.username,
                    fullName: lib.full_name,
                    employeeId: lib.employee_id,
                    email: lib.email,
                    phone: lib.phone || 'N/A',
                    institution: lib.institution || ''
                }
            });
        } catch (error) {
            console.error('Librarian updateProfile error:', error);
            return res.status(500).json({ success: false, message: 'Failed to update profile' });
        }
    }

    static async login(req, res) {
        try {
            const { username, password } = req.body;
            const platform = String(req.body.platform || 'MOBILE').toUpperCase() === 'WEB'
                ? 'WEB' : 'MOBILE';

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username and password are required'
                });
            }

            const [rows] = await pool.execute(
                `SELECT id, username, password, password_format, full_name, employee_id, email, phone, institution, is_active
                    FROM librarians
                  WHERE username = ? OR employee_id = ? OR email = ?`,
                [username, username, username]
            );

            if (!rows || rows.length === 0) {
                return res.status(401).json({ success: false, message: 'Invalid librarian credentials' });
            }

            const librarian = rows[0];

            const lock = await LoginLockout.checkLocked('librarians', librarian.id);
            if (lock.locked) {
                return res.status(423).json({
                    success: false,
                    message: `Account is temporarily locked due to repeated failed login attempts. Try again after ${new Date(lock.until).toLocaleTimeString()}.`
                });
            }

            if (!librarian.is_active) {
                return res.status(403).json({
                    success: false,
                    message: 'Account is inactive. Contact system administrator.'
                });
            }

            const isMatch = await verifyPassword(password, librarian);
            if (!isMatch) {
                await LoginLockout.registerFailure('librarians', librarian.id);
                return res.status(401).json({ success: false, message: 'Invalid librarian credentials' });
            }

            await LoginLockout.clearLock('librarians', librarian.id);

            const sid = crypto.randomBytes(32).toString('hex');
            // NEW: write the sid to the platform-specific column.
            const sessionColumn = platform === 'WEB' ? 'current_session_web' : 'current_session_id';
            await pool.execute(
                `UPDATE librarians SET ${sessionColumn} = ? WHERE id = ?`,
                [sid, librarian.id]
            );

            const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

            const token = jwt.sign(
                {
                    id: librarian.id,
                    username: librarian.username,
                    employeeId: librarian.employee_id,
                    institution: librarian.institution || null,
                    type: 'LIBRARIAN',
                    role: 'librarian',
                    sid,
                    platform // NEW
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            // NEW: set cookie for web callers only.
            if (platform === 'WEB') {
                res.cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000,
                    path: '/'
                });
            }

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
                    phone: librarian.phone || "N/A",
                    institution: librarian.institution || ""
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Internal server error during authentication' });
        }
    }

    static async getPendingRequests(req, res) {
        try {
            const institution = req.user && req.user.institution ? req.user.institution : null;

            if (!institution) {
                return res.json({
                    success: true,
                    count: 0,
                    requests: [],
                    data: []
                });
            }

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
                  AND b.institution IS NOT NULL
                  AND (b.institution = ? OR b.institution = ?)
                ORDER BY br.request_date ASC
            `, [institution, GLOBAL_INSTITUTION]);

            res.json({
                success: true,
                count: rows ? rows.length : 0,
                requests: rows || [],
                data: rows || []
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve pending requests'
            });
        }
    }

    static async approveRequest(req, res) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const requestId = req.params.id;
            const librarianId = req.user ? req.user.id : null;
            const institution = req.user && req.user.institution ? req.user.institution : null;

            const [requests] = await connection.execute(
                `SELECT br.*, b.title AS book_title, b.institution AS book_institution
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

            if (!institution) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Your account has no institution assigned'
                });
            }
            const bookInst = request.book_institution;
            if (!bookInst || (bookInst !== institution && bookInst !== GLOBAL_INSTITUTION)) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'This request is for a book outside your institution'
                });
            }

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
                    } catch (e) { }
                }

                await connection.execute(
                    `UPDATE book_requests 
                     SET status = 'APPROVED', 
                         approved_by = ?, 
                         approval_date = NOW(),
                         borrow_date = NOW(),
                         due_date = DATE_ADD(NOW(), INTERVAL 14 DAY)
                     WHERE id = ?`,
                    [librarianId, requestId]
                );
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
                    } catch (e) { }
                }

                await connection.execute(
                    `UPDATE book_requests 
                     SET status = 'RETURNED', 
                         approved_by = ?, 
                         approval_date = NOW(),
                         return_date = NOW()
                     WHERE id = ?`,
                    [librarianId, requestId]
                );
            } else {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Unknown request type: ${request.request_type}`
                });
            }

            await connection.commit();

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
                } catch (notifErr) { }
            })();

            res.json({
                success: true,
                message: `Request successfully approved (${request.request_type})`
            });
        } catch (error) {
            await connection.rollback();
            res.status(500).json({
                success: false,
                message: 'Failed to approve request'
            });
        } finally {
            connection.release();
        }
    }

    static async rejectRequest(req, res) {
        try {
            const requestId = req.params.id;
            const { rejectionReason, reason, notes } = req.body;
            const finalReason = rejectionReason || reason || notes || 'No reason provided';
            const librarianId = req.user ? req.user.id : null;
            const institution = req.user && req.user.institution ? req.user.institution : null;

            const [requests] = await pool.execute(
                `SELECT br.*, b.title AS book_title, b.institution AS book_institution
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

            if (!institution) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has no institution assigned'
                });
            }
            const bookInst = request.book_institution;
            if (!bookInst || (bookInst !== institution && bookInst !== GLOBAL_INSTITUTION)) {
                return res.status(403).json({
                    success: false,
                    message: 'This request is for a book outside your institution'
                });
            }

            await pool.execute(
                `UPDATE book_requests 
                 SET status = 'REJECTED', notes = ?, remark = ?, remark_by = ?, remark_date = NOW() 
                 WHERE id = ?`,
                [finalReason, finalReason, librarianId, requestId]
            );

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
                } catch (notifErr) { }
            })();

            res.json({
                success: true,
                message: 'Request successfully rejected'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Failed to reject request'
            });
        }
    }

    static async getStatistics(req, res) {
        try {
            const institution = req.user && req.user.institution ? req.user.institution : null;

            if (!institution) {
                const empty = {
                    activeUsers: 0, active_users: 0,
                    activeLibrarians: 0, active_librarians: 0,
                    totalBooks: 0, total_books: 0,
                    availableBooks: 0, available_books: 0,
                    pendingRequests: 0, pending_requests: 0,
                    activeBorrows: 0
                };
                return res.json({ success: true, statistics: empty, data: empty });
            }

            const [[totalBooks]] = await pool.execute(
                `SELECT COUNT(*) AS count FROM books
                  WHERE institution IS NOT NULL
                    AND (institution = ? OR institution = ?)`,
                [institution, GLOBAL_INSTITUTION]
            );
            const [[availableBooks]] = await pool.execute(
                `SELECT SUM(available_quantity) AS count FROM books
                  WHERE institution IS NOT NULL
                    AND (institution = ? OR institution = ?)`,
                [institution, GLOBAL_INSTITUTION]
            );

            const [[pendingRequests]] = await pool.execute(
                `SELECT COUNT(*) AS count
                   FROM book_requests br
                   JOIN books b ON br.book_id = b.id
                  WHERE br.status = 'PENDING'
                    AND b.institution IS NOT NULL
                    AND (b.institution = ? OR b.institution = ?)`,
                [institution, GLOBAL_INSTITUTION]
            );

            const [[totalUsers]] = await pool.execute(
                `SELECT COUNT(*) AS count FROM users
                  WHERE role = 'STUDENT'
                    AND institution = ?`,
                [institution]
            );

            let activeLibrariansCount = 0;
            try {
                const [[librarians]] = await pool.execute(
                    `SELECT COUNT(*) AS count FROM librarians
                      WHERE is_active = 1 AND institution = ?`,
                    [institution]
                );
                activeLibrariansCount = librarians ? librarians.count : 0;
            } catch (e) { }

            let activeBorrowsCount = 0;
            try {
                const [[borrows]] = await pool.execute(
                    `SELECT COUNT(*) AS count
                       FROM book_requests br
                       JOIN books b ON br.book_id = b.id
                      WHERE br.status = 'APPROVED'
                        AND br.request_type = 'BORROW'
                        AND b.institution IS NOT NULL
                        AND (b.institution = ? OR b.institution = ?)`,
                    [institution, GLOBAL_INSTITUTION]
                );
                activeBorrowsCount = borrows ? borrows.count : 0;
            } catch (e) { }

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
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve dashboard statistics'
            });
        }
    }

    static async getRequestHistory(req, res) {
        try {
            const { status, requestType, search, limit } = req.query;
            const institution = req.user && req.user.institution ? req.user.institution : null;

            if (!institution) {
                return res.json({ success: true, count: 0, history: [], data: [] });
            }

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
                WHERE b.institution IS NOT NULL
                  AND (b.institution = ? OR b.institution = ?)
            `;

            const params = [institution, GLOBAL_INSTITUTION];

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

            query += ` ORDER BY br.request_date DESC LIMIT ${finalLimit}`;

            const [rows] = await pool.execute(query, params);

            res.json({
                success: true,
                count: rows ? rows.length : 0,
                history: rows || [],
                data: rows || []
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve request history'
            });
        }
    }

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
            res.status(500).json({
                success: false,
                message: 'Failed to add remark'
            });
        }
    }

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
            res.status(500).json({
                success: false,
                message: 'Failed to verify identity.'
            });
        }
    }

      // ============================================================
    // UPDATED — POST /api/librarian/reset-password
    //
    // Now nulls BOTH current_session_id and current_session_web so
    // that a self-service password reset kicks out Android AND web
    // sessions for that librarian. The response body is unchanged
    // (still `{ success: true, message: 'Password reset successfully.' }`),
    // so no Android caller needs to change.
    // ============================================================
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

            // CHANGED: nulls BOTH session columns so both Android
            // and web sessions are invalidated at once.
            await pool.execute(
                `UPDATE librarians
                    SET current_session_id = NULL,
                        current_session_web = NULL
                  WHERE id = ?`,
                [rows[0].id]
            );

            res.json({
                success: true,
                message: 'Password reset successfully. You can now login.'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Failed to reset password.'
            });
        }
    }

    static async getBorrowTrends(req, res) {
        try {
            const institution = req.user && req.user.institution ? req.user.institution : null;

            let days = parseInt(req.query.days, 10);
            if (isNaN(days) || days < 1) days = 7;
            if (days > 90) days = 90;

            if (!institution) {
                return res.json({
                    success: true,
                    data: {
                        days,
                        dailyBorrows: [],
                        byType: [],
                        topBooks: [],
                        byStatus: []
                    }
                });
            }

            const [dailyRows] = await pool.execute(`
                SELECT 
                    DATE(br.request_date) AS date,
                    COUNT(*) AS count
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                WHERE br.request_type = 'BORROW'
                  AND br.status IN ('APPROVED', 'COMPLETED', 'RETURNED')
                  AND br.request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                  AND b.institution IS NOT NULL
                  AND (b.institution = ? OR b.institution = ?)
                GROUP BY DATE(br.request_date)
                ORDER BY date ASC
            `, [days, institution, GLOBAL_INSTITUTION]);

            const [typeRows] = await pool.execute(`
                SELECT 
                    br.request_type AS type,
                    COUNT(*) AS count
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                WHERE br.request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                  AND b.institution IS NOT NULL
                  AND (b.institution = ? OR b.institution = ?)
                GROUP BY br.request_type
            `, [days, institution, GLOBAL_INSTITUTION]);

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
                  AND b.institution IS NOT NULL
                  AND (b.institution = ? OR b.institution = ?)
                GROUP BY b.id, b.title, b.author
                ORDER BY count DESC
                LIMIT 5
            `, [days, institution, GLOBAL_INSTITUTION]);

            const [statusRows] = await pool.execute(`
                SELECT 
                    br.status,
                    COUNT(*) AS count
                FROM book_requests br
                JOIN books b ON br.book_id = b.id
                WHERE br.request_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                  AND b.institution IS NOT NULL
                  AND (b.institution = ? OR b.institution = ?)
                GROUP BY br.status
            `, [days, institution, GLOBAL_INSTITUTION]);

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
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve analytics'
            });
        }
    }

    static async listMyInstitutionBooks(req, res) {
        try {
            const institution = req.user?.institution || null;
            const [rows] = await pool.execute(
                `SELECT * FROM books
                  WHERE (? IS NULL OR institution = ?)
                  ORDER BY title LIMIT 500`,
                [institution, institution]
            );
            res.json({ success: true, count: rows.length, data: rows });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Failed to list books' });
        }
    }

    static async addBook(req, res) {
        try {
            const institution = req.user?.institution || req.body.institution || null;
            if (!institution) {
                return res.status(400).json({
                    success: false,
                    message: 'Your librarian account has no institution assigned'
                });
            }
            const {
                title, author, isbn, category, level, quantity,
                availableQuantity, publishedYear, cover_image_url
            } = req.body;

            if (!title || !author || quantity === undefined) {
                return res.status(400).json({ success: false, message: 'title, author, quantity required' });
            }

            const duplicate = await LibrarianController._findDuplicateBook({
                institution,
                title,
                author,
                isbn
            });
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    code: 'BOOK_ALREADY_EXISTS',
                    message: `A book titled "${duplicate.title}" by ${duplicate.author || 'Unknown Author'} ` +
                             `already exists for your institution` +
                             (duplicate.isbn ? ` (ISBN: ${duplicate.isbn})` : '') +
                             `. Please update the existing record instead of adding a new one.`,
                    existingBookId: duplicate.id
                });
            }

            const Book = require('../models/Book');
            const id = await Book.create({
                title, author, isbn, category, level,
                quantity,
                availableQuantity: availableQuantity ?? quantity,
                publishedYear: publishedYear ?? null,
                institution,
                createdBy: req.user.id,
                cover_image_url: cover_image_url ?? null
            });
            res.status(201).json({ success: true, message: 'Book added', bookId: id });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Failed to add book' });
        }
    }

    static async _findDuplicateBook({ institution, title, author, isbn }) {
        const trimmedIsbn = (isbn || '').toString().trim();
        if (trimmedIsbn !== '') {
            const [rows] = await pool.execute(
                `SELECT id, title, author, isbn
                   FROM books
                  WHERE isbn = ?
                    AND institution = ?
                  LIMIT 1`,
                [trimmedIsbn, institution]
            );
            return rows.length > 0 ? rows[0] : null;
        }

        const trimmedTitle = (title || '').toString().trim();
        const trimmedAuthor = (author || '').toString().trim();
        if (trimmedTitle === '' || trimmedAuthor === '') return null;

        const [rows] = await pool.execute(
            `SELECT id, title, author, isbn
               FROM books
              WHERE institution = ?
                AND LOWER(TRIM(title))  = LOWER(TRIM(?))
                AND LOWER(TRIM(author)) = LOWER(TRIM(?))
              LIMIT 1`,
            [institution, trimmedTitle, trimmedAuthor]
        );
        return rows.length > 0 ? rows[0] : null;
    }

    static async updateMyInstitutionBook(req, res) {
        try {
            const institution = req.user?.institution || null;
            const [rows] = await pool.execute('SELECT institution FROM books WHERE id = ?', [req.params.id]);
            if (!rows.length) return res.status(404).json({ success: false, message: 'Book not found' });
            if (institution && rows[0].institution && rows[0].institution !== institution) {
                return res.status(403).json({ success: false, message: 'Not your institution' });
            }

            const Book = require('../models/Book');
            const ok = await Book.update(req.params.id, req.body);
            if (!ok) return res.status(400).json({ success: false, message: 'No changes' });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Failed to update book' });
        }
    }

    static async deleteMyInstitutionBook(req, res) {
        try {
            const institution = req.user?.institution || null;
            const [rows] = await pool.execute(
                'SELECT institution FROM books WHERE id = ?',
                [req.params.id]
            );
            if (!rows.length) {
                return res.status(404).json({ success: false, message: 'Book not found' });
            }
            if (institution && rows[0].institution && rows[0].institution !== institution) {
                return res.status(403).json({ success: false, message: 'Not your institution' });
            }
            const [[{ count }]] = await pool.execute(
                'SELECT COUNT(*) AS count FROM book_requests WHERE book_id = ?',
                [req.params.id]
            );
            if (count > 0) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot delete "${req.body.title || 'this book'}": ` +
                             `${count} borrow/return record(s) reference it. ` +
                             `Keep the record for audit history.`
                });
            }
            const Book = require('../models/Book');
            await Book.deleteById(req.params.id);
            res.json({ success: true, message: 'Book deleted' });
        } catch (e) {
            console.error('deleteMyInstitutionBook error:', e);
            res.status(500).json({ success: false, message: 'Failed to delete book' });
        }
    }
}
module.exports = LibrarianController;
