// routes/settings.js — User settings management
const express = require('express');
const { requireAuth }   = require('../middleware/auth');
const { get, run }      = require('../database/db');
const { v4: uuidv4 }    = require('uuid');

const router = express.Router();

// ---- GET /api/settings ----
router.get('/', requireAuth, async (req, res) => {
  const { get, run, db, IS_SUPABASE } = require('../database/db');
  let settings;

  try {
    if (IS_SUPABASE) {
      const sb = require('../database/db').supabase;
      const { data } = await sb.from('user_settings').select('*').eq('user_id', req.user.id).single();
      settings = data;
      if (!settings) {
        const { data: newSettings } = await sb.from('user_settings').upsert({ id: uuidv4(), user_id: req.user.id }).select().single();
        settings = newSettings;
      }
    } else {
      settings = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
      if (!settings) {
        const now = Math.floor(Date.now() / 1000);
        await run('INSERT INTO user_settings (id, user_id, updated_at) VALUES (?, ?, ?)', [uuidv4(), req.user.id, now]);
        settings = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
      }
    }
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- PATCH /api/settings ----
router.patch('/', requireAuth, async (req, res) => {
  const { get, run, IS_SUPABASE } = require('../database/db');
  const {
    autoPostEnabled, postsPerWeek, preferredDays, preferredTimeHour,
    autoScheduleNew, defaultIntent, defaultTone
  } = req.body;

  const validDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  if (preferredDays && !preferredDays.split(',').map(d => d.trim().toLowerCase()).every(d => validDays.includes(d))) {
    return res.status(400).json({ error: 'Invalid preferred days' });
  }

  try {
    let updated;
    if (IS_SUPABASE) {
      const sb = require('../database/db').supabase;
      
      // Update payload
      const updates = {};
      if (autoPostEnabled !== undefined) updates.auto_post_enabled = autoPostEnabled ? 1 : 0;
      if (postsPerWeek !== undefined) updates.posts_per_week = postsPerWeek;
      if (preferredDays !== undefined) updates.preferred_days = preferredDays;
      if (preferredTimeHour !== undefined) updates.preferred_time_hour = preferredTimeHour;
      if (autoScheduleNew !== undefined) updates.auto_schedule_new = autoScheduleNew ? 1 : 0;
      if (defaultIntent !== undefined) updates.default_intent = defaultIntent;
      if (defaultTone !== undefined) updates.default_tone = defaultTone;

      const { data, error } = await sb.from('user_settings')
        .update(updates)
        .eq('user_id', req.user.id)
        .select()
        .single();
      
      if (error && error.code === 'PGRST116') {
        // Did not exist, upsert instead
        updates.id = uuidv4();
        updates.user_id = req.user.id;
        const { data: upsertData } = await sb.from('user_settings').upsert(updates).select().single();
        updated = upsertData;
      } else {
        updated = data;
      }
    } else {
      const now = Math.floor(Date.now() / 1000);
      await run(`
        UPDATE user_settings SET
          auto_post_enabled   = COALESCE(?, auto_post_enabled),
          posts_per_week      = COALESCE(?, posts_per_week),
          preferred_days      = COALESCE(?, preferred_days),
          preferred_time_hour = COALESCE(?, preferred_time_hour),
          auto_schedule_new   = COALESCE(?, auto_schedule_new),
          default_intent      = COALESCE(?, default_intent),
          default_tone        = COALESCE(?, default_tone),
          updated_at          = ?
        WHERE user_id = ?
      `, [
        autoPostEnabled !== undefined ? (autoPostEnabled ? 1 : 0) : null,
        postsPerWeek ?? null, preferredDays ?? null, preferredTimeHour ?? null,
        autoScheduleNew !== undefined ? (autoScheduleNew ? 1 : 0) : null,
        defaultIntent ?? null, defaultTone ?? null, now, req.user.id
      ]);
      updated = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    }
    
    res.json({ settings: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
