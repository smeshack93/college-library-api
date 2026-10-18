/**
 * Centralized password policy for the API.
 * Mirrors the Android PasswordValidator.java rules so that the client
 * and server cannot drift apart.
 *
 * Rule: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit,
 * 1 special char from the set @ # $ % ^ & + = ! . _ -
 */
const PASSWORD_PATTERN =
  /^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%^&+=!._\-]).{8,}$/;

const MIN_LENGTH = 8;

function isValid(password) {
  return typeof password === 'string' && PASSWORD_PATTERN.test(password);
}

function requirementShort() {
  return 'Password must be at least 8 characters and include uppercase, lowercase, number and special character';
}

function requirementLong() {
  return 'Min 8 characters, with uppercase, lowercase, number, and special character (e.g. @ # $ % ^ & + = ! . _ -).';
}

module.exports = {
  MIN_LENGTH,
  isValid,
  requirementShort,
  requirementLong,
};
