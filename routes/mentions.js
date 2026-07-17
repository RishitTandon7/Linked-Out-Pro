// routes/mentions.js — Mention Contact Book API
const express  = require('express');
const crypto   = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { IS_SUPABASE, supabase: sb, run, get, all } = require('../database/db');

const router = express.Router();

// ---- GET /api/mentions — list saved mention contacts ----
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let contacts;
    if (IS_SUPABASE) {
      const { data, error } = await sb.from('mention_contacts')
        .select('*')
        .eq('user_id', userId)
        .order('display_name');
      if (error) throw error;
      contacts = data || [];
    } else {
      contacts = await all(
        'SELECT * FROM mention_contacts WHERE user_id = ? ORDER BY display_name',
        [userId]
      );
    }
    res.json({ contacts });
  } catch (e) {
    console.error('GET /api/mentions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- POST /api/mentions — add a new mention contact ----
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { displayName, linkedinId, avatarUrl } = req.body;

    if (!displayName || !linkedinId) {
      return res.status(400).json({ error: 'displayName and linkedinId are required' });
    }

    // Normalize: strip the full URN prefix if the user pasted it
    const personId = linkedinId
      .replace(/^urn:li:person:/i, '')
      .replace(/^urn:li:organization:/i, '')
      .trim();

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    if (IS_SUPABASE) {
      const { data, error } = await sb.from('mention_contacts').insert({
        id,
        user_id: userId,
        display_name: displayName.trim(),
        linkedin_id: personId,
        avatar_url: avatarUrl || null,
        created_at: now
      }).select().single();
      if (error) throw error;
      return res.json({ contact: data });
    } else {
      await run(
        `INSERT INTO mention_contacts (id, user_id, display_name, linkedin_id, avatar_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, userId, displayName.trim(), personId, avatarUrl || null, now]
      );
      const contact = await get('SELECT * FROM mention_contacts WHERE id = ?', [id]);
      return res.json({ contact });
    }
  } catch (e) {
    console.error('POST /api/mentions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- DELETE /api/mentions/:id — remove a contact ----
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (IS_SUPABASE) {
      const { error } = await sb.from('mention_contacts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
    } else {
      await run(
        'DELETE FROM mention_contacts WHERE id = ? AND user_id = ?',
        [id, userId]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/mentions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
