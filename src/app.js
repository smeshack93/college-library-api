const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const admin = require('firebase-admin');

// 1. Load environment variables from ca.env BEFORE anything else
require('dotenv').config({ path: path.resolve(__dirname, '../ca.env') });

// 2. Import Database Configuration
const pool = require('./config/database');

// 3. Import Routes
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const librarianRoutes = require('./routes/librarian');

const app = express();

// --- Firebase Initialization ---
try {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  // Quick verification log
  (async () => {
    try {
      const token = await admin.auth().createCustomToken("test-user-id");
      console.log("✅ Firebase initialized successfully. Test token generated.");
    } catch (err) {
      console.error("⚠️ Firebase verification failed:", err.message);
    }
  })();
} catch (err) {
  console.error("❌ Firebase initialization error:", err.message);
}

// --- Middleware ---
app.use(helmet()); 
app.use(cors());   
app.use(morgan('dev')); 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// --- API Routes ---

// Welcome Route
app.get('/', (req, res) => {
  res.json({ 
    message: 'College Library API',
    status: 'Running',
    config_source: 'ca.env'
  });
});

/**
 * DUAL HEALTH CHECK
 * Fixes "Connection Failed" by responding to both root and api paths.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), db_connected: !!pool });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), db_connected: !!pool });
});

/**
 * SINGLE ROUTE MOUNTING WITH /api PREFIX
 * This is the standard REST practice
 */
app.use('/api/auth', authRoutes);           
app.use('/api/books', bookRoutes);         
app.use('/api/librarian', librarianRoutes); 

// --- Error Handling ---
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Route ${req.originalUrl} not found. Check path nesting.` 
  });
});

app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err.stack);
  res.status(err.status || 500).json({ 
    success: false, 
    message: err.message || 'Internal Server Error' 
  });
});

// --- Server Initialization ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('--------------------------------------------------');
  console.log(`🚀 Server running on port: ${PORT}`);
  console.log(`📝 Logic: Supporting /api prefix only`);
  console.log('--------------------------------------------------');
});

module.exports = app;
