// routes/cron.js
// Called by GitHub Actions on a schedule to publish due posts
// Protected by a CRON_SECRET header — never expose this secret

const express = require('express');
const { publishDuePosts } = require('../services/scheduler');

const router = express.Router();

// ---- GET/POST /api/cron/trigger ----
// Vercel Cron or GitHub Actions calls this periodically
router.all('/trigger', async (req, res) => {
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

// ---- GET /api/cron/health ----
// GitHub Actions can ping this to confirm the server is up
router.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

module.exports = router;
