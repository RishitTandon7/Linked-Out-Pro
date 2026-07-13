// server.js — LinkedOut Pro Express Server
// Works on: local dev (node), Vercel (serverless)
require('dotenv').config();
const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
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

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
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

// ---- Version endpoint — used by the client to detect when a new deploy is live ----
const APP_VERSION = '1.7.0';
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
