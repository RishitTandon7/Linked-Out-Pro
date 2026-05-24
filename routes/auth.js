// routes/auth.js — LinkedIn + Google OAuth flows
const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const { getAuthUrl, exchangeCodeForToken, getUserProfile } = require('../services/linkedin');
const { createToken } = require('../middleware/auth');
const db = require('../database/db');



const router = express.Router();

// In-memory state store (good enough for single-instance; use Redis in production)
const oauthStates = new Map();

// ---- GET /api/auth/linkedin ----
// Redirect user to LinkedIn OAuth page
router.get('/linkedin', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { createdAt: Date.now() });

  // Clean up old states
  for (const [k, v] of oauthStates) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) oauthStates.delete(k);
  }

  const authUrl = getAuthUrl(state);
  res.redirect(authUrl);
});

// ---- GET /api/auth/linkedin/callback ----
// LinkedIn redirects here after user authorizes
router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error)}`);
  }
  if (!state || !oauthStates.has(state)) {
    return res.redirect('/?error=invalid_state');
  }
  oauthStates.delete(state);

  try {
    // Exchange code for token
    const tokenData = await exchangeCodeForToken(code);

    // Get user profile
    const profile = await getUserProfile(tokenData.accessToken);

    const now     = Math.floor(Date.now() / 1000);
    const expires = tokenData.expiresIn ? now + tokenData.expiresIn : null;

    let user;

    if (db.IS_SUPABASE) {
      // ---- Supabase path ----
      const supabase = db.supabase;

      // Upsert the user (insert or update on linkedin_id conflict)
      const { data: upserted, error: upsertErr } = await supabase
        .from('users')
        .upsert({
          linkedin_id:   profile.linkedinId,
          name:          profile.name,
          email:         profile.email,
          avatar_url:    profile.avatarUrl,
          access_token:  tokenData.accessToken,
          token_expires: expires,
          updated_at:    now,
        }, {
          onConflict:       'linkedin_id',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (upsertErr) throw new Error('DB upsert failed: ' + upsertErr.message);
      user = upserted;

      // Ensure user_settings row exists (ignore if already there)
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, updated_at: now }, { onConflict: 'user_id', ignoreDuplicates: true });

    } else {
      // ---- SQLite path ----
      const { run, get } = db;

      const existing = await get('SELECT * FROM users WHERE linkedin_id = ?', [profile.linkedinId]);

      if (existing) {
        await run(`
          UPDATE users SET name=?, email=?, avatar_url=?, access_token=?, token_expires=?, updated_at=?
          WHERE linkedin_id=?
        `, [profile.name, profile.email, profile.avatarUrl, tokenData.accessToken, expires, now, profile.linkedinId]);
        user = await get('SELECT * FROM users WHERE linkedin_id = ?', [profile.linkedinId]);
      } else {
        const id = crypto.randomUUID();
        await run(`
          INSERT INTO users (id, linkedin_id, name, email, avatar_url, access_token, token_expires, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, profile.linkedinId, profile.name, profile.email, profile.avatarUrl, tokenData.accessToken, expires, now, now]);

        await run(`INSERT INTO user_settings (id, user_id, updated_at) VALUES (?, ?, ?)`, [crypto.randomUUID(), id, now]);
        user = await get('SELECT * FROM users WHERE id = ?', [id]);
      }
    }

    if (!user) throw new Error('User record not found after save');

    // Issue JWT
    const token = createToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax'
    });

    res.redirect('/dashboard');
  } catch (e) {
    console.error('OAuth callback error:', e);
    res.redirect(`/?error=${encodeURIComponent('Authentication failed: ' + e.message)}`);
  }
});



// ---- GET /api/auth/me ----
// Returns current user info (for frontend)
router.get('/me', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.json({ user: null });

  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    let user;
    if (db.IS_SUPABASE) {
      const { data } = await db.supabase
        .from('users')
        .select('id, linkedin_id, name, email, headline, avatar_url, created_at')
        .eq('id', payload.id)
        .single();
      user = data;
    } else {
      user = await db.get('SELECT id, linkedin_id, name, email, headline, avatar_url, created_at FROM users WHERE id = ?', [payload.id]);
    }

    res.json({ user: user || null });
  } catch {
    res.json({ user: null });
  }
});

// ---- POST /api/auth/logout ----
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ---- POST /api/auth/fcm-token ----
const { requireAuth } = require('../middleware/auth');
router.post('/fcm-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token provided' });
  try {
    if (db.IS_SUPABASE) {
      await db.supabase.from('users').update({ fcm_token: token }).eq('id', req.user.id);
    } else {
      await db.run('UPDATE users SET fcm_token = ? WHERE id = ?', [token, req.user.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
