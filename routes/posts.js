// routes/posts.js — Post management (CRUD + schedule + publish)
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { requireAuth }     = require('../middleware/auth');
const { IS_SUPABASE, supabase: sb, run, get, all } = require('../database/db');
const { publishSinglePost } = require('../services/scheduler');
const { notifyPostScheduled } = require('../services/notifications');
const { deleteImage } = require('../services/storage');

const router = express.Router();

// ---- Helpers ----
async function getPosts(userId, status, limit = 50, offset = 0) {
  if (IS_SUPABASE) {
    let q = sb.from('posts').select('*').eq('user_id', userId);
    if (status) q = q.eq('status', status);
    const { data } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    return data || [];
  } else {
    let sql = 'SELECT * FROM posts WHERE user_id = ?';
    const params = [userId];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    return await all(sql, params);
  }
}
async function getPost(id, userId) {
  if (IS_SUPABASE) {
    const { data } = await sb.from('posts').select('*').eq('id', id).eq('user_id', userId).single();
    return data;
  }
  return await get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
}
async function getPostImages(postId) {
  if (IS_SUPABASE) {
    const { data } = await sb.from('post_images').select('*').eq('post_id', postId).order('sort_order');
    return data || [];
  }
  return await all('SELECT * FROM post_images WHERE post_id = ? ORDER BY sort_order', [postId]);
}
async function getUser(userId) {
  if (IS_SUPABASE) {
    const { data } = await sb.from('users').select('*').eq('id', userId).single();
    return data;
  }
  return await get('SELECT * FROM users WHERE id = ?', [userId]);
}
async function updatePost(id, updates) {
  const now = Math.floor(Date.now() / 1000);
  if (IS_SUPABASE) {
    const { data } = await sb.from('posts').update({ ...updates, updated_at: now }).eq('id', id).select().single();
    return data;
  }
  const setClauses = Object.keys(updates).map(k => `${k}=?`).join(', ');
  await run(`UPDATE posts SET ${setClauses}, updated_at=? WHERE id=?`, [...Object.values(updates), now, id]);
  return await get('SELECT * FROM posts WHERE id = ?', [id]);
}
async function countPosts(userId) {
  if (IS_SUPABASE) {
    const statuses = ['draft', 'scheduled', 'published'];
    const counts = await Promise.all(statuses.map(s =>
      sb.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', s)
    ));
    const [d, sc, p] = counts.map(r => r.count || 0);
    return { total: d + sc + p, drafts: d, scheduled: sc, published: p };
  } else {
    const [total, published, scheduled, drafts] = await Promise.all([
      get('SELECT COUNT(*) as c FROM posts WHERE user_id = ?', [userId]),
      get("SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND status = 'published'", [userId]),
      get("SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND status = 'scheduled'", [userId]),
      get("SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND status = 'draft'", [userId]),
    ]);
    return { total: total?.c || 0, published: published?.c || 0, scheduled: scheduled?.c || 0, drafts: drafts?.c || 0 };
  }
}

// ---- GET /api/posts ----
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const posts = await getPosts(req.user.id, status, limit, offset);
    for (const post of posts) {
      post.images = await getPostImages(post.id);
    }
    res.json({ posts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- GET /api/posts/stats/overview ----
router.get('/stats/overview', requireAuth, async (req, res) => {
  try {
    const counts = await countPosts(req.user.id);
    res.json(counts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- GET /api/posts/:id ----
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    post.images = await getPostImages(post.id);
    res.json({ post });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- POST /api/posts ----
router.post('/', requireAuth, async (req, res) => {
  try {
    const { postText, hashtags, intent = 'manual', tone = 'manual' } = req.body;
    const now = Math.floor(Date.now() / 1000);
    const postId = crypto.randomUUID();
    if (IS_SUPABASE) {
      const { data, error } = await sb.from('posts').insert({
        id: postId, user_id: req.user.id, post_text: postText || '',
        hashtags: hashtags || '', intent, tone, status: 'draft', created_at: now, updated_at: now
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ post: data });
    } else {
      await run(`INSERT INTO posts (id, user_id, post_text, hashtags, intent, tone, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [postId, req.user.id, postText || '', hashtags || '', intent, tone, 'draft', now, now]);
      const post = await get('SELECT * FROM posts WHERE id = ?', [postId]);
      res.json({ post });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- POST /api/posts/bulk-schedule ----
// IMPORTANT: must be registered BEFORE /:id routes so Express doesn't match
// "bulk-schedule" as a post ID
router.post('/bulk-schedule', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Provide items array' });
    const results = [];
    for (const item of items) {
      const post = await getPost(item.postId, req.user.id);
      if (!post || post.status === 'published') continue;
      const ts = Math.floor(new Date(item.scheduledAt).getTime() / 1000);
      await updatePost(item.postId, { status: 'scheduled', scheduled_at: ts });

      // Notify — wrapped so a Firebase/FCM error never blocks the bulk schedule
      try { await notifyPostScheduled(req.user.id, ts); } catch (notifErr) {
        console.warn('Bulk-schedule notification failed (non-fatal):', notifErr.message);
      }

      results.push({ postId: item.postId, scheduledAt: ts });
    }
    res.json({ scheduled: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PATCH /api/posts/:id ----
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { postText, hashtags, intent, tone } = req.body;
    const post = await getPost(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'published') return res.status(400).json({ error: 'Cannot edit a published post' });
    const updates = {};
    if (postText  !== undefined) updates.post_text = postText;
    if (hashtags  !== undefined) updates.hashtags  = hashtags;
    if (intent    !== undefined) updates.intent    = intent;
    if (tone      !== undefined) updates.tone      = tone;
    const updated = await updatePost(req.params.id, updates);
    res.json({ post: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- POST /api/posts/:id/schedule ----
router.post('/:id/schedule', requireAuth, async (req, res) => {
  try {
    const { scheduledAt, postText, hashtags } = req.body;
    const post = await getPost(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'published') return res.status(400).json({ error: 'Post already published' });
    const scheduledTs = typeof scheduledAt === 'number' ? scheduledAt : Math.floor(new Date(scheduledAt).getTime() / 1000);
    if (isNaN(scheduledTs) || scheduledTs < Math.floor(Date.now() / 1000))
      return res.status(400).json({ error: 'scheduledAt must be a future date/time' });

    // Build update payload — always include the fresh postText/hashtags from the
    // client if provided, so the cron job publishes the full untruncated text.
    const updates = { status: 'scheduled', scheduled_at: scheduledTs };
    if (postText !== undefined) updates.post_text = postText;
    if (hashtags !== undefined) updates.hashtags  = hashtags;
    await updatePost(req.params.id, updates);

    // Notify — wrapped so a Firebase/FCM error never blocks the schedule response
    try { await notifyPostScheduled(req.user.id, scheduledTs); } catch (notifErr) {
      console.warn('Schedule notification failed (non-fatal):', notifErr.message);
    }

    res.json({ success: true, scheduledAt: scheduledTs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- POST /api/posts/:id/publish-now ----
router.post('/:id/publish-now', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'published') return res.status(400).json({ error: 'Already published' });
    const user = await getUser(req.user.id);

    // If the client sent fresh postText/hashtags, write them to DB first.
    // This protects against any Supabase VARCHAR column limit that may silently
    // truncate text on the initial save. We then publish using those values
    // directly rather than re-reading from DB.
    const freshText     = req.body?.postText;
    const freshHashtags = req.body?.hashtags;
    if (freshText !== undefined) {
      await updatePost(post.id, {
        post_text: freshText,
        hashtags:  freshHashtags !== undefined ? freshHashtags : post.hashtags
      });
    }

    // Verify images exist in DB before publishing
    const images = await getPostImages(post.id);
    console.log(`📸 Publish-now: post ${post.id} has ${images.length} image(s) in DB`);

    await updatePost(post.id, { scheduled_at: Math.floor(Date.now() / 1000) });

    // Build the post object — prefer fresh text from request body over DB value
    const fullPost = {
      ...post,
      post_text:    freshText     !== undefined ? freshText     : post.post_text,
      hashtags:     freshHashtags !== undefined ? freshHashtags : post.hashtags,
      access_token: user.access_token,
      linkedin_id:  user.linkedin_id
    };
    console.log(`📏 Publishing post_text length: ${fullPost.post_text?.length} chars`);

    const result = await publishSinglePost(fullPost);
    if (!result) return res.status(500).json({ error: 'Failed to publish to LinkedIn. Check server logs.' });
    const updated = await getPost(post.id, req.user.id);
    res.json({ success: true, post: updated });
  } catch (e) {
    console.error('Publish-now error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- POST /api/posts/:id/unschedule ----
router.post('/:id/unschedule', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.id);
    if (!post || post.status !== 'scheduled') return res.status(400).json({ error: 'Post is not scheduled' });
    await updatePost(req.params.id, { status: 'draft', scheduled_at: null });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- DELETE /api/posts/:id ----
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const images = await getPostImages(post.id);

    // Clean up stored image files
    images.forEach(img => {
      try {
        const uDir = process.env.VERCEL ? require('os').tmpdir() : (process.env.UPLOADS_DIR || './uploads');
        fs.unlinkSync(path.join(uDir, img.filename));
      } catch {}
    });

    if (IS_SUPABASE) {
      // Explicitly delete images from storage bucket and from the DB
      for (const img of images) {
        try {
          if (img.storage_path) await deleteImage(img.storage_path);
        } catch {}
      }
      await sb.from('post_images').delete().eq('post_id', req.params.id);
      await sb.from('posts').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    } else {
      await run('DELETE FROM posts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
