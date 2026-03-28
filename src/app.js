const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

// 1. Load environment variables from ca.env BEFORE anything else
require('dotenv').config({ path: path.resolve(__dirname, '../ca.env') });

// 2. Import Database Configuration
const pool = require('./config/database');

// 3. Import Routes
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const librarianRoutes = require('./routes/librarian');

const app = express();

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
 * DUAL ROUTE MOUNTING
 * This fixes your 404 errors. 
 * It allows the app to find /auth/login OR /api/auth/login.
 */
// Support for requests WITHOUT /api prefix (fixes your current 404 logs)
app.use('/auth', authRoutes);           
app.use('/books', bookRoutes);         
app.use('/librarian', librarianRoutes); 

// Support for requests WITH /api prefix (Standard REST practice)
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
  console.log(`📝 Logic: Supporting both /api and root paths`);
  console.log('--------------------------------------------------');
});

module.exports = app;