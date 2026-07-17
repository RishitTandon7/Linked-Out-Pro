// server.js — LinkedOut Pro Express Server
// Works on: local dev (node), Vercel (serverless)
require('dotenv').config();
const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const helmet       = require('helmet');
const xss          = require('xss-clean');
const rateLimit    = require('express-rate-limit');
const { initSchema } = require('./database/db');
const { startScheduler } = require('./services/scheduler');
const { trackPageView }  = require('./middleware/traffic');

// Routes
const authRoutes      = require('./routes/auth');
const analyzeRoutes   = require('./routes/analyze');
const postsRoutes     = require('./routes/posts');
const settingsRoutes  = require('./routes/settings');
const cronRoutes      = require('./routes/cron');
const analyticsRoutes = require('./routes/analytics');
const bossRoutes      = require('./routes/boss');
const mentionsRoutes  = require('./routes/mentions');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
// Security headers
app.use(helmet({
  contentSecurityPolicy: false // Disabled for now to avoid breaking existing inline scripts/styles
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' })); // Body size limit to prevent huge payloads
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());
app.use(xss()); // Sanitize req.body, req.query, and req.params from XSS

// Global Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});
app.use('/api', globalLimiter); // Apply to all /api routes

app.use(trackPageView); // 📊 Site traffic tracker

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded images locally in dev
if (process.env.NODE_ENV !== 'production') {
  const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
  app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));
}

// ---- API Routes ----
app.use('/api/auth',      authRoutes);
app.use('/api/analyze',   analyzeRoutes);
app.use('/api/posts',     postsRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/cron',      cronRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/boss',      bossRoutes);
app.use('/api/mentions',  mentionsRoutes);

// ---- Version endpoint — used by the client to detect when a new deploy is live ----
const APP_VERSION = '1.8.0';
app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// ---- SPA Fallback ----
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/login', (req, res) => {
  res.redirect('/api/auth/linkedin');
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/boss', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'boss.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Error Handler ----
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max size is 10MB per image.' });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---- Start (local only — on Vercel, app is exported) ----
const IS_VERCEL = process.env.VERCEL === '1';

if (!IS_VERCEL) {
  (async function main() {
    await initSchema();
    startScheduler();
    app.listen(PORT, () => {
      console.log(`\n🚀 LinkedOut Pro running at http://localhost:${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
      console.log(`🔗 LinkedIn OAuth: http://localhost:${PORT}/api/auth/linkedin`);
      console.log(`🔔 Cron endpoint: http://localhost:${PORT}/api/cron/trigger\n`);
    });
  })().catch(e => { console.error('Fatal:', e); process.exit(1); });
} else {
  // On Vercel: schema is managed by Supabase migrations, scheduler is disabled
  initSchema().catch(console.error);
}

// Export for Vercel serverless
module.exports = app;
