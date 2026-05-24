// routes/cron.js
// Triggered by:
//   1. GitHub Actions every 5 min (x-cron-secret header) — offline backup
//   2. Dashboard client every 60s (JWT session cookie) — real-time, when app is open
// The debug endpoint remains secret-only.

const express = require('express');
const jwt     = require('jsonwebtoken');
const { publishDuePosts } = require('../services/scheduler');
const { IS_SUPABASE, supabase: sb } = require('../database/db');

const router = express.Router();

const JWT_SECRET  = process.env.JWT_SECRET  || 'fallback_secret_change_this';

// ---- Secret validation middleware (GitHub Actions / manual) ----
function requireCronSecret(req, res, next) {
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET) return next();

  // Vercel native cron header (future-proofing)
  if (req.headers['x-vercel-cron'] === '1') return next();

  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const provided = req.headers['x-cron-secret'] ||
                   req.query.secret              ||
                   bearerToken                   ||
                   req.body?.secret;

  if (provided !== CRON_SECRET) {
    console.warn('🚫 Cron: invalid or missing secret from', req.ip);
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ---- Dual-auth middleware for /trigger ----
// Accepts EITHER the cron secret (GitHub Actions) OR a valid user JWT session (dashboard)
function requireCronOrUser(req, res, next) {
  const CRON_SECRET = process.env.CRON_SECRET;

  // No secret configured = dev mode, allow all
  if (!CRON_SECRET) { req.cronSource = 'dev'; return next(); }

  // Vercel native cron
  if (req.headers['x-vercel-cron'] === '1') { req.cronSource = 'vercel'; return next(); }

  // Check cron secret (GitHub Actions)
  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const secretProvided = req.headers['x-cron-secret'] ||
                         req.query.secret              ||
                         bearerToken                   ||
                         req.body?.secret;
  if (secretProvided === CRON_SECRET) { req.cronSource = 'github-actions'; return next(); }

  // Check JWT session cookie (logged-in dashboard user)
  const token = req.cookies?.token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      req.cronSource = 'dashboard-client';
      return next();
    } catch { /* invalid token — fall through to 401 */ }
  }

  console.warn('🚫 Cron /trigger: unauthorized from', req.ip);
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// ---- GET/POST /api/cron/trigger ----
// Called by GitHub Actions (offline backup) and dashboard client (real-time, every 60s)
router.all('/trigger', requireCronOrUser, async (req, res) => {
  console.log(`🔔 Cron triggered by [${req.cronSource || 'unknown'}] at`, new Date().toISOString());
  try {
    const result = await publishDuePosts();
    if (result?.published > 0) {
      console.log(`🔔 Cron result: published=${result.published}, failed=${result.failed}`);
    }
    res.json({
      ok:             true,
      triggeredAt:    new Date().toISOString(),
      source:         req.cronSource || 'unknown',
      published:      result?.published  || 0,
      failed:         result?.failed     || 0,
      skipped:        result?.skipped    || 0,
      postsFound:     result?.postsFound || 0,
      totalScheduled: result?.totalScheduled,
      nextScheduled:  result?.nextScheduled,
      nowTs:          result?.nowTs,
      errors:         result?.errors     || []
    });
  } catch (e) {
    console.error('Cron trigger error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ---- GET /api/cron/debug ----
// Returns current state of scheduled/failed posts and their fail_reason
// Protected by the same cron secret to prevent data leakage
router.get('/debug', requireCronSecret, async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);

    if (!IS_SUPABASE) {
      return res.json({ error: 'Only available in Supabase (production) mode' });
    }

    // Get all scheduled posts
    const { data: scheduled } = await sb.from('posts')
      .select('id, post_text, scheduled_at, status, fail_reason, updated_at, user_id')
      .eq('status', 'scheduled')
      .order('scheduled_at');

    // Get recently failed posts (last 24h)
    // updated_at is stored as epoch seconds (integer) in our schema
    const since = now - 86400;
    const { data: failed } = await sb.from('posts')
      .select('id, post_text, scheduled_at, status, fail_reason, updated_at, user_id')
      .eq('status', 'failed')
      .gte('updated_at', since)
      .order('updated_at', { ascending: false });

    // Check users have valid tokens
    const userIds = [...new Set([
      ...(scheduled || []).map(p => p.user_id),
      ...(failed || []).map(p => p.user_id)
    ])];
    const { data: users } = await sb.from('users')
      .select('id, name, linkedin_id, token_expires')
      .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

    const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));
    const overdue = (scheduled || []).filter(p => p.scheduled_at <= now);

    res.json({
      nowTs:     now,
      nowHuman:  new Date().toISOString(),
      scheduled: (scheduled || []).map(p => ({
        id:           p.id,
        preview:      (p.post_text || '').slice(0, 80),
        scheduled_at: p.scheduled_at,
        overdue:      p.scheduled_at <= now,
        user:         userMap[p.user_id]?.name,
        token_expires: userMap[p.user_id]?.token_expires,
        token_valid:  (userMap[p.user_id]?.token_expires || 0) > now
      })),
      overdue_count: overdue.length,
      failed_recent: (failed || []).map(p => ({
        id:         p.id,
        preview:    (p.post_text || '').slice(0, 80),
        fail_reason: p.fail_reason,
        failed_at:  new Date(p.updated_at * 1000).toISOString(),
        user:       userMap[p.user_id]?.name
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- GET /api/cron/health ----
router.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

module.exports = router;
