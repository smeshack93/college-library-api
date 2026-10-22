const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * Extracts the bearer token from either:
 *   - the Authorization header (Android, existing behavior), OR
 *   - the `token` httpOnly cookie (new web path).
 *
 * Android requests never carry cookies, so its behavior is identical.
 */
function extractToken(req) {
  const authHeader = req.header('Authorization');
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/i, '').trim() || null;
  }
  if (req.cookies && req.cookies.token) {
    return String(req.cookies.token).trim() || null;
  }
  return null;
}

/**
 * Verifies the JWT and confirms the sid still matches the DB row.
 *
 * NEW: the sid is checked against `current_session_web` when the
 * token's `platform` is 'WEB', otherwise against `current_session_id`.
 * Older tokens issued before this change have no `platform` field and
 * therefore keep using `current_session_id` — Android unaffected.
 */
async function verifyAndCheckSession(token) {
  const payload = jwt.verify(token, JWT_SECRET);

  if (!payload || !payload.id) {
    return { ok: false, reason: 'no-id' };
  }
  if (!payload.sid) {
    return { ok: false, reason: 'no-sid' };
  }

  const role = String(payload.type || payload.role || '').toUpperCase();
  const table = role === 'LIBRARIAN' ? 'librarians' : 'users';
  const sessionColumn = payload.platform === 'WEB'
    ? 'current_session_web'
    : 'current_session_id';

  const [rows] = await pool.execute(
    `SELECT ${sessionColumn} AS stored_sid FROM ${table} WHERE id = ? LIMIT 1`,
    [payload.id]
  );

  if (!rows || rows.length === 0) {
    return { ok: false, reason: 'no-row' };
  }

  const stored = rows[0].stored_sid;
  if (!stored || stored !== payload.sid) {
    return { ok: false, reason: 'sid-mismatch' };
  }

  return { ok: true, payload };
}

const authMiddleware = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  }
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
  const token = extractToken(req);
  if (token) {
    try {
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
