// routes/mentions.js — Mention Contact Book API
const express  = require('express');
const crypto   = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { IS_SUPABASE, supabase: sb, run, get, all } = require('../database/db');

const router = express.Router();

/**
 * Parse a LinkedIn profile or company URL into a clean display name.
 * e.g. "https://www.linkedin.com/in/rishit-tandon-54a954400/" → "Rishit Tandon"
 * e.g. "https://www.linkedin.com/company/openai/" → "Openai"
 */
function parseDisplayNameFromUrl(url) {
  // Person profile: /in/<vanity-slug>/
  const personMatch = url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-]+)/i);
  if (personMatch) {
    const slug = personMatch[1]; // e.g. "rishit-tandon-54a954400"
    const parts = slug.split('-');

    // Drop trailing purely-numeric or long alphanumeric suffix (vanity collision suffix)
    // e.g. "54a954400" or "4x7q" — anything ≥6 chars at the end that looks like an ID
    const lastPart = parts[parts.length - 1];
    const nameparts = (lastPart.length >= 6 || /^\d+$/.test(lastPart))
      ? parts.slice(0, -1)
      : parts;

    return nameparts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || slug;
  }

  // Company page: /company/<slug>/
  const companyMatch = url.match(/linkedin\.com\/company\/([a-zA-Z0-9\-]+)/i);
  if (companyMatch) {
    const slug = companyMatch[1];
    return slug.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  return null;
}

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

// ---- POST /api/mentions — add a new mention contact from a LinkedIn URL ----
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { profileUrl } = req.body;

    if (!profileUrl || !profileUrl.includes('linkedin.com')) {
      return res.status(400).json({ error: 'A valid LinkedIn profile URL is required.' });
    }

    const displayName = parseDisplayNameFromUrl(profileUrl.trim());
    if (!displayName) {
      return res.status(400).json({ error: 'Could not parse a name from that URL. Make sure it is a /in/ or /company/ LinkedIn URL.' });
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    if (IS_SUPABASE) {
      const { data, error } = await sb.from('mention_contacts').insert({
        id,
        user_id: userId,
        display_name: displayName,
        linkedin_id: profileUrl.trim(), // store the full URL as the identifier
        avatar_url: null,
        created_at: now
      }).select().single();
      if (error) throw error;
      return res.json({ contact: data });
    } else {
      await run(
        `INSERT INTO mention_contacts (id, user_id, display_name, linkedin_id, avatar_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, userId, displayName, profileUrl.trim(), null, now]
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
