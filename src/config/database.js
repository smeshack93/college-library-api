// 1. Tell dotenv exactly which file to load
require('dotenv').config({ path: './ca.env' }); 

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// 2. Build SSL configuration
let sslConfig = null;
const certPath = path.resolve(process.env.DB_SSL_CERT_PATH || './certs/ca.pem');

if (fs.existsSync(certPath)) {
    sslConfig = {
        ca: fs.readFileSync(certPath).toString()
    };
    console.log('🔒 SSL Certificate loaded from:', certPath);
} else {
    console.warn('⚠️ SSL Certificate not found. Check your ca.env and certs folder.');
}

// 3. Create the Pool object
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 23102,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: sslConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 4. Immediate Connection Test
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

module.exports = pool;