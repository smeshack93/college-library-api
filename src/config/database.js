// config/database.js
const path = require('path');
const fs   = require('fs');

// 1. Load env vars from ca.env (same behaviour as before)
require('dotenv').config({ path: path.resolve(__dirname, '../../ca.env') });

const mysql = require('mysql2/promise');

// 2. Build SSL config (unchanged, just made more defensive)
let sslConfig = null;
const certPath = path.resolve(
    process.env.DB_SSL_CERT_PATH || path.join(__dirname, '../../certs/ca.pem')
);

if (fs.existsSync(certPath)) {
    sslConfig = { ca: fs.readFileSync(certPath).toString() };
    console.log('🔒 SSL Certificate loaded from:', certPath);
} else {
    console.warn('⚠️ SSL Certificate not found. Check ca.env and certs folder.');
}

// 3. Pool — with the two critical timezone flags
const pool = mysql.createPool({
    host:               process.env.DB_HOST,
    port:               parseInt(process.env.DB_PORT, 10) || 23102,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME,
    ssl:                sslConfig,

    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    charset:            'utf8mb4',

    // ⭐ Force mysql2 to treat every DATETIME as UTC.
    // Combined with SQL that uses UTC_TIMESTAMP() (see §4 below), this
    // makes the whole stack timezone-agnostic and fixes the raw "Z"
    // string that was confusing the Android screen.
    timezone:           'Z',
    dateStrings:        false
});

// 4. Immediate connection test (kept — useful in Render logs)
pool.getConnection()
    .then(conn => {
        console.log('✅ Database connected successfully using ca.env');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed!');
        console.log('📋 Current variables in ca.env:');
        console.log('- Host:', process.env.DB_HOST);
        console.log('- User:', process.env.DB_USER);
        console.error('- Error Details:', err.message);
    });

module.exports = { pool };
