const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');   // NEW

// 1. Load environment variables from ca.env BEFORE anything else
require('dotenv').config({ path: path.resolve(__dirname, '../ca.env') });

// 2. Import Database Configuration
const pool = require('./config/database');

// 3. Import Routes
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const librarianRoutes = require('./routes/librarian');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

const app = express();

// NEW: trust Render's reverse proxy so req.ip reflects the client IP.
// Without this, express-rate-limit sees the proxy's IP and one user
// can lock out every other user for the same window.
app.set('trust proxy', 1);

// --- Firebase Initialization ---
try {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

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

// CHANGED: credentials:true so the browser will attach the httpOnly
// cookie on cross-origin requests. Web-app origin added.
// Android is unaffected — OkHttp ignores CORS entirely.
app.use(cors({
  origin: [
    'https://college-library-api-xyb6.onrender.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:4173',             // NEW: Vite preview
    'https://your-web-app.vercel.app'    // NEW: replace when deployed
  ],
  credentials: true
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());                  // NEW: after body parsers

// --- Static file serving for institution branding / book covers ---
// Anything placed in ./public is reachable at /static/<path>
// Example: public/images/logo.jpg  →  https://your-api.onrender.com/static/images/logo.jpg
app.use('/static', express.static(path.join(__dirname, '../public')));

// --- API Routes ---

app.get('/', (req, res) => {
  res.json({
    message: 'College Library API',
    status: 'Running',
    config_source: 'ca.env'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), db_connected: !!pool });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), db_connected: !!pool });
});

app.use('/api/auth', authRoutes);
app.use('/api/librarian', librarianRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/user', userRoutes);

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
