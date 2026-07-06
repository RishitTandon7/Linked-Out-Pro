// routes/boss.js — Owner-only admin dashboard API
// Gated behind: req.user.email === 'rishit.tandon.7@gmail.com'
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../database/db');

const router = express.Router();

const OWNER_EMAIL = 'rishit.tandon.7@gmail.com';

// ---- Owner Guard Middleware ----
async function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  
  let email = req.user.email;
  if (!email && req.user.id) {
    try {
      if (db.IS_SUPABASE) {
        const { data } = await db.supabase.from('users').select('email').eq('id', req.user.id).single();
        email = data?.email;
      } else {
        const row = await db.get('SELECT email FROM users WHERE id = ?', [req.user.id]);
        email = row?.email;
      }
    } catch (e) {
      console.error('requireOwner DB error:', e.message);
    }
  }

  if (email !== OWNER_EMAIL) {
    return res.status(403).json({ error: 'Access denied. Owner only.' });
  }
  next();
}

// Helper: get current unix timestamp boundaries
function getTimeBoundaries() {
  const now = Math.floor(Date.now() / 1000);
  const startOfToday = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const startOfWeek  = startOfToday - (new Date().getDay() * 86400);
  const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
  const thirtyDaysAgo = now - 30 * 86400;
  return { now, startOfToday, startOfWeek, startOfMonth, thirtyDaysAgo };
}

// ---- GET /api/boss/stats ----
// Returns aggregate stats for the dashboard
router.get('/stats', requireAuth, requireOwner, async (req, res) => {
  try {
    const { startOfToday, startOfWeek, startOfMonth } = getTimeBoundaries();

    if (db.IS_SUPABASE) {
      const sb = db.supabase;

      // Total users
      const { count: totalUsers } = await sb.from('users').select('*', { count: 'exact', head: true });

      // Signups today
      const { count: signupsToday } = await sb.from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfToday);

      // Signups this week
      const { count: signupsWeek } = await sb.from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfWeek);

      // Signups this month
      const { count: signupsMonth } = await sb.from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfMonth);

      // DAU: users who generated/published something today (via posts table updated_at)
      const { count: dau } = await sb.from('posts')
        .select('user_id', { count: 'exact', head: true })
        .gte('created_at', startOfToday);

      // Total captions (all posts ever created)
      const { count: totalCaptions } = await sb.from('posts')
        .select('*', { count: 'exact', head: true });

      // Captions today
      const { count: captionsToday } = await sb.from('posts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfToday);

      res.json({
        totalUsers:     totalUsers   || 0,
        signupsToday:   signupsToday || 0,
        signupsWeek:    signupsWeek  || 0,
        signupsMonth:   signupsMonth || 0,
        dau:            dau          || 0,
        totalCaptions:  totalCaptions  || 0,
        captionsToday:  captionsToday  || 0,
      });

    } else {
      // SQLite path
      const { get } = db;
      const totalUsers    = (await get('SELECT COUNT(*) as c FROM users'))?.c || 0;
      const signupsToday  = (await get('SELECT COUNT(*) as c FROM users WHERE created_at >= ?', [startOfToday]))?.c || 0;
      const signupsWeek   = (await get('SELECT COUNT(*) as c FROM users WHERE created_at >= ?', [startOfWeek]))?.c || 0;
      const signupsMonth  = (await get('SELECT COUNT(*) as c FROM users WHERE created_at >= ?', [startOfMonth]))?.c || 0;
      const dau           = (await get('SELECT COUNT(DISTINCT user_id) as c FROM posts WHERE created_at >= ?', [startOfToday]))?.c || 0;
      const totalCaptions = (await get('SELECT COUNT(*) as c FROM posts'))?.c || 0;
      const captionsToday = (await get('SELECT COUNT(*) as c FROM posts WHERE created_at >= ?', [startOfToday]))?.c || 0;

      res.json({ totalUsers, signupsToday, signupsWeek, signupsMonth, dau, totalCaptions, captionsToday });
    }

  } catch (e) {
    console.error('Boss stats error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- GET /api/boss/users ----
// Returns paginated user list with email, signup date, last active
router.get('/users', requireAuth, requireOwner, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    let users = [];
    let total = 0;

    if (db.IS_SUPABASE) {
      const sb = db.supabase;

      const { data, count } = await sb.from('users')
        .select('id, name, email, avatar_url, created_at, updated_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      users = data || [];
      total = count || 0;

    } else {
      const { all, get } = db;
      users = await all(
        `SELECT id, name, email, avatar_url, created_at, updated_at
         FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      total = (await get('SELECT COUNT(*) as c FROM users'))?.c || 0;
    }

    res.json({ users, total, limit, offset });

  } catch (e) {
    console.error('Boss users error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- GET /api/boss/signups-chart ----
// Returns daily signup counts for the past 30 days for charting
router.get('/signups-chart', requireAuth, requireOwner, async (req, res) => {
  try {
    const { thirtyDaysAgo } = getTimeBoundaries();
    let chartData = [];

    if (db.IS_SUPABASE) {
      const sb = db.supabase;
      const { data } = await sb.from('users')
        .select('created_at')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: true });

      chartData = buildDailyBuckets(data || [], 'created_at', 30);

    } else {
      const { all } = db;
      const rows = await all(
        `SELECT created_at FROM users WHERE created_at >= ? ORDER BY created_at ASC`,
        [thirtyDaysAgo]
      );
      chartData = buildDailyBuckets(rows, 'created_at', 30);
    }

    res.json({ chartData });

  } catch (e) {
    console.error('Boss chart error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- Helper: aggregate rows into daily buckets ----
function buildDailyBuckets(rows, field, days) {
  const buckets = {};
  const now = new Date();

  // Pre-fill all days with 0
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    buckets[key] = 0;
  }

  for (const row of rows) {
    const ts = row[field];
    let dateKey;

    if (typeof ts === 'number') {
      // Unix timestamp (seconds)
      dateKey = new Date(ts * 1000).toISOString().slice(0, 10);
    } else if (typeof ts === 'string') {
      dateKey = ts.slice(0, 10);
    }

    if (dateKey && buckets[dateKey] !== undefined) {
      buckets[dateKey]++;
    }
  }

  return Object.entries(buckets).map(([date, count]) => ({ date, count }));
}

module.exports = router;
