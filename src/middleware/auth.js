const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * Verifies the JWT, then confirms the token's session id (sid) still
 * matches the current_session_id stored on the account row. If they
 * don't match, the token has been superseded by a newer login and the
 * request is rejected with 401.
 */
async function verifyAndCheckSession(token) {
  const payload = jwt.verify(token, JWT_SECRET);

  if (!payload || !payload.id) {
    return { ok: false, reason: 'no-id' };
  }

  // Tokens issued before the session-id feature have no `sid`. Treat
  // them as invalid so they cannot bypass the new check.
  if (!payload.sid) {
    return { ok: false, reason: 'no-sid' };
  }

  const role = String(payload.type || payload.role || '').toUpperCase();
  const table = role === 'LIBRARIAN' ? 'librarians' : 'users';

  const [rows] = await pool.execute(
    `SELECT current_session_id FROM ${table} WHERE id = ? LIMIT 1`,
    [payload.id]
  );

  if (!rows || rows.length === 0) {
    return { ok: false, reason: 'no-row' };
  }

  const stored = rows[0].current_session_id;
  if (!stored || stored !== payload.sid) {
    return { ok: false, reason: 'sid-mismatch' };
  }

  return { ok: true, payload };
}

const authMiddleware = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  if (!token) return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  try {
    const result = await verifyAndCheckSession(token);
    if (!result.ok) {
      return res.status(401).json({ success: false, message: 'Session is no longer valid. Please sign in again.' });
    }
    req.user = result.payload;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Token is not valid or has expired' });
  }
};

const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;
  if (token) {
    try {
      // Only verify the JWT here — the session check is deliberately
      // skipped on public routes so a stale token behaves like a guest.
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
};

const librarianAuth = (req, res, next) => {
  authMiddleware(req, res, () => {
    const role = (req.user?.type || req.user?.role || '').toUpperCase();
    if (role !== 'LIBRARIAN') {
      return res.status(403).json({ success: false, message: 'Access denied. Librarian only.' });
    }
    next();
  });
};

const adminAuth = (req, res, next) => {
  authMiddleware(req, res, () => {
    const role = (req.user?.type || req.user?.role || '').toUpperCase();
    if (role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
    }
    next();
  });
};

module.exports = { authMiddleware, optionalAuthMiddleware, librarianAuth, adminAuth };
