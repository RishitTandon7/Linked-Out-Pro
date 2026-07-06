// middleware/traffic.js — Lightweight page-view tracker
// Records every page hit to the page_views table (or in-memory for Supabase).
// Only tracks public HTML pages; skips /api/, /uploads/, static assets.

const db = require('../database/db');

// Pages we care about tracking
const TRACKED_PAGES = ['/', '/dashboard', '/boss'];

// In-memory buffer so we don't hammer the DB on every request.
// Flushed every 30 s (or when the buffer hits 50 entries).
let _buffer = [];
let _flushTimer = null;

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH_SIZE  = 50;

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

async function flushBuffer() {
  if (!_buffer.length) return;
  const rows = _buffer.splice(0, _buffer.length);

  try {
    if (db.IS_SUPABASE) {
      await db.supabase.from('page_views').insert(rows);
    } else {
      const stmt = `INSERT INTO page_views (page, ts, referrer) VALUES (?, ?, ?)`;
      await Promise.all(rows.map(r => db.run(stmt, [r.page, r.ts, r.referrer || ''])));
    }
  } catch (e) {
    console.warn('[traffic] flush error:', e.message);
  }
}

// Express middleware — attach to app before routes
function trackPageView(req, res, next) {
  // Only track page-level GET requests
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/uploads/')) return next();
  // Skip assets (css, js, images, fonts)
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)$/i.test(req.path)) return next();

  const page = TRACKED_PAGES.includes(req.path) ? req.path : req.path;
  const ts   = Math.floor(Date.now() / 1000);
  const ref  = (req.headers['referer'] || req.headers['referrer'] || '').slice(0, 255);

  _buffer.push({ page, ts, referrer: ref });

  if (_buffer.length >= FLUSH_BATCH_SIZE) {
    flushBuffer().catch(() => {});
  } else {
    scheduleFlush();
  }

  next();
}

module.exports = { trackPageView, flushBuffer };
