/**
 * Account-level login lockout helper.
 * Applied on every failed login attempt:
 *   - increment failed_login_attempts
 *   - if it reaches MAX_ATTEMPTS, set locked_until = now + LOCK_MINUTES
 *
 * Applied on every successful login:
 *   - reset failed_login_attempts to 0
 *   - clear locked_until
 *
 * Called from authController.login and librarianController.login.
 */
const { pool } = require('../config/database');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function lockDurationSql() {
  return `DATE_ADD(NOW(), INTERVAL ${LOCK_MINUTES} MINUTE)`;
}

/**
 * Returns true when the account is currently locked.
 * Also returns the lock time (ISO string) for the message, or null.
 */
async function checkLocked(table, id) {
  const [rows] = await pool.execute(
    `SELECT locked_until FROM ${table} WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return { locked: false, until: null };
  const until = rows[0].locked_until;
  if (!until) return { locked: false, until: null };
  const untilMs = new Date(until).getTime();
  return { locked: untilMs > Date.now(), until };
}

/**
 * Increments the failed-attempt counter, and if the threshold is
 * reached, sets locked_until to (now + LOCK_MINUTES).
 */
async function registerFailure(table, id) {
  // Two-step so we can log the resulting state for debugging.
  await pool.execute(
    `UPDATE ${table}
        SET failed_login_attempts = failed_login_attempts + 1
      WHERE id = ?`,
    [id]
  );
  const [rows] = await pool.execute(
    `SELECT failed_login_attempts FROM ${table} WHERE id = ? LIMIT 1`,
    [id]
  );
  const attempts = rows.length ? rows[0].failed_login_attempts : 0;
  if (attempts >= MAX_ATTEMPTS) {
    await pool.execute(
      `UPDATE ${table}
          SET locked_until = ${lockDurationSql()},
              failed_login_attempts = 0
        WHERE id = ?`,
      [id]
    );
  }
  return attempts;
}

/**
 * Clears the counter and any lock. Called after a successful login.
 */
async function clearLock(table, id) {
  await pool.execute(
    `UPDATE ${table}
        SET failed_login_attempts = 0, locked_until = NULL
      WHERE id = ?`,
    [id]
  );
}

module.exports = {
  MAX_ATTEMPTS,
  LOCK_MINUTES,
  checkLocked,
  registerFailure,
  clearLock,
};
