// utils/passwordUtils.js
const crypto = require('crypto');

const PBKDF2_PREFIX = 'PBKDF2:';
const SHA256_PREFIX = 'SHA256:';
const KEY_LENGTH = 256; // bits
const ITERATIONS = 100000; // Must match Java's ConfigManager.PASSWORD_ITERATIONS

/**
 * Verifies a password against a stored hash (supports PBKDF2, SHA256, plain text)
 */
function verifyPassword(inputPassword, storedHash) {
    // CRITICAL FIX: Validate inputs first
    if (!inputPassword || typeof inputPassword !== 'string') {
        console.error('Invalid input password:', typeof inputPassword);
        return false;
    }
    
    if (!storedHash || typeof storedHash !== 'string') {
        console.error('Invalid stored hash:', typeof storedHash, storedHash);
        return false;
    }

    try {
        // 1. Check for PBKDF2 format (from Java desktop app)
        if (storedHash.startsWith(PBKDF2_PREFIX)) {
            // Format: PBKDF2:ITERATIONS:SALT:HASH
            const hashPart = storedHash.substring(PBKDF2_PREFIX.length);
            const parts = hashPart.split(':');
            
            if (parts.length !== 3) {
                console.error('Invalid PBKDF2 format. Expected 3 parts, got:', parts.length);
                return false;
            }
            
            try {
                const iterations = parseInt(parts[0], 10);
                const salt = Buffer.from(parts[1], 'base64');
                const storedHashBuffer = Buffer.from(parts[2], 'base64');
                
                // Generate hash using same parameters
                const derivedKey = crypto.pbkdf2Sync(
                    inputPassword,
                    salt,
                    iterations,
                    KEY_LENGTH / 8,
                    'sha256'
                );
                
                // Constant-time comparison
                if (storedHashBuffer.length !== derivedKey.length) {
                    return false;
                }
                
                return crypto.timingSafeEqual(storedHashBuffer, derivedKey);
            } catch (err) {
                console.error('PBKDF2 verification error:', err.message);
                return false;
            }
        }
        
        // 2. Check for SHA256 format (legacy)
        if (storedHash.startsWith(SHA256_PREFIX)) {
            try {
                const storedHashValue = storedHash.substring(SHA256_PREFIX.length);
                const computedHash = crypto.createHash('sha256').update(inputPassword).digest('hex');
                return storedHashValue === computedHash;
            } catch (err) {
                console.error('SHA256 verification error:', err.message);
                return false;
            }
        }
        
        // 3. Check for plain text (fallback)
        if (!storedHash.includes(':')) {
            return inputPassword === storedHash;
        }
        
        // 4. Unknown format
        console.error('Unknown password format:', storedHash.substring(0, 50));
        return false;
        
    } catch (error) {
        console.error('Password verification error:', error);
        return false;
    }
}

/**
 * Hashes a password using PBKDF2 (for new user registration to match Java format)
 */
function hashPassword(password) {
    try {
        if (!password || typeof password !== 'string') {
            throw new Error('Invalid password for hashing');
        }
        
        const salt = crypto.randomBytes(16);
        const iterations = ITERATIONS;
        const keyLength = KEY_LENGTH / 8;
        
        const hash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
        
        return `${PBKDF2_PREFIX}${iterations}:${salt.toString('base64')}:${hash.toString('base64')}`;
    } catch (error) {
        console.error('Password hashing error:', error);
        throw new Error('Failed to hash password');
    }
}

/**
 * Debug function to check stored hash format
 */
function debugHashFormat(storedHash) {
    if (!storedHash) {
        console.log('Hash is null or undefined');
        return;
    }
    
    if (typeof storedHash !== 'string') {
        console.log('Hash is not a string:', typeof storedHash);
        return;
    }
    
    console.log('Hash analysis:');
    console.log('  Length:', storedHash.length);
    console.log('  First 50 chars:', storedHash.substring(0, 50));
    
    if (storedHash.startsWith(PBKDF2_PREFIX)) {
        console.log('  ✅ PBKDF2 format detected');
        const parts = storedHash.substring(PBKDF2_PREFIX.length).split(':');
        console.log('  Parts count:', parts.length);
        if (parts.length >= 1) console.log('  Iterations:', parts[0]);
        if (parts.length >= 2) console.log('  Salt (base64):', parts[1]?.substring(0, 20) + '...');
        if (parts.length >= 3) console.log('  Hash (base64):', parts[2]?.substring(0, 20) + '...');
    } else if (storedHash.startsWith(SHA256_PREFIX)) {
        console.log('  ⚠️ SHA256 format detected (legacy)');
    } else if (!storedHash.includes(':')) {
        console.log('  ⚠️ Plain text format detected');
    } else {
        console.log('  ❌ Unknown format');
    }
}

module.exports = { verifyPassword, hashPassword, debugHashFormat };