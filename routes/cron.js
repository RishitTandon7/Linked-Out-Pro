// routes/cron.js
// Called by GitHub Actions on a schedule to publish due posts
// Protected by a CRON_SECRET header — never expose this secret

const express = require('express');
const { publishDuePosts } = require('../services/scheduler');

const router = express.Router();

// ---- Secret validation middleware ----
function requireCronSecret(req, res, next) {
  const CRON_SECRET = process.env.CRON_SECRET;
  // If no secret is configured, allow (dev mode)
  if (!CRON_SECRET) return next();

  const provided = req.headers['x-cron-secret'] ||
                   req.query.secret ||
                   req.body?.secret;
  if (provided !== CRON_SECRET) {
    console.warn('🚫 Cron: invalid or missing secret from', req.ip);
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ---- GET/POST /api/cron/trigger ----
// Vercel Cron or GitHub Actions calls this periodically
router.all('/trigger', requireCronSecret, async (req, res) => {
  console.log(`🔔 Cron triggered (${req.method}) at`, new Date().toISOString());
  try {
    const result = await publishDuePosts();
    console.log('🔔 Cron result:', JSON.stringify(result));
    res.json({
      ok:             true,
      triggeredAt:    new Date().toISOString(),
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
router.get('/debug', async (req, res) => {
  try {
    const { IS_SUPABASE, supabase: sb } = require('../database/db');
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
