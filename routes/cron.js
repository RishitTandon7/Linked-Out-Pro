// routes/cron.js
// Called by GitHub Actions on a schedule to publish due posts
// Protected by a CRON_SECRET header — never expose this secret

const express = require('express');
const { publishDuePosts } = require('../services/scheduler');

const router = express.Router();

// Simple secret-header auth (not JWT — this is a machine-to-machine call)
function requireCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET === 'your_cron_secret_here') {
    // Cron secret not set — log warning but allow in dev
    console.warn('⚠️  CRON_SECRET not set. Cron endpoint is unprotected!');
    return next();
  }
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---- POST /api/cron/trigger ----
// GitHub Actions hits this every N minutes
router.post('/trigger', requireCronSecret, async (req, res) => {
  console.log('🔔 Cron triggered at', new Date().toISOString());
  try {
    const result = await publishDuePosts();
    res.json({
      ok:          true,
      triggeredAt: new Date().toISOString(),
      published:   result?.published  || 0,
      failed:      result?.failed     || 0,
      skipped:     result?.skipped    || 0
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
