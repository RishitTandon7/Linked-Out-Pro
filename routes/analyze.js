// routes/analyze.js — Image upload + Gemini analysis + post generation
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { generateLinkedInPost, suggestSchedule } = require('../services/gemini');
const { IS_SUPABASE, supabase: sb, run, get, all } = require('../database/db');
const { getNextPostingSlots } = require('../services/scheduler');
const { uploadImage, deleteImage } = require('../services/storage');

const router = express.Router();

// ---- Multer storage config ----
const os = require('os');
const UPLOADS_DIR = process.env.VERCEL ? os.tmpdir() : (process.env.UPLOADS_DIR || './uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '10') * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ---- POST /api/analyze/generate ----
// Upload images (optional), analyze with Gemini, return generated post
router.post('/generate', requireAuth, upload.array('images', 10), async (req, res) => {
  const { context = '', intent = 'achievement', tone = 'professional' } = req.body;

  // Images are optional — allow text-only generation
  const hasImages = req.files && req.files.length > 0;

  try {
    const imageFiles = hasImages ? req.files.map(f => ({ path: f.path, mimetype: f.mimetype })) : [];
    
    // Format current date for Gemini context (e.g. "Monday, June 22, 2026")
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const result      = await generateLinkedInPost(imageFiles, context, intent, tone, currentDate);

    // Save as draft post in DB
    const postId  = crypto.randomUUID();
    const now     = Math.floor(Date.now() / 1000);

    if (IS_SUPABASE) {
      const { error: pErr } = await sb.from('posts').insert({
        id: postId, user_id: req.user.id, post_text: result.postText,
        hashtags: result.hashtags, intent, tone, ai_analysis: result.analysis,
        status: 'draft', created_at: now, updated_at: now
      });
      if (pErr) throw new Error('Post insert failed: ' + pErr.message);

      const safeFiles = req.files || [];
      console.log(`📝 Post ${postId} created. Saving ${safeFiles.length} image(s)...`);

      for (let i = 0; i < safeFiles.length; i++) {
        const f = safeFiles[i];

        // Upload to Supabase Storage so image persists across serverless invocations
        let storageUrl = null, storagePath = null, localPath = f.path;
        try {
          const stored = await uploadImage(f.path, f.filename, f.mimetype);
          storageUrl  = stored.url;
          storagePath = stored.storagePath;
          localPath   = stored.localPath || f.path;
          console.log(`☁️  Image ${i} uploaded to storage: ${storageUrl || localPath}`);
        } catch (uploadErr) {
          console.warn(`⚠️  Supabase Storage upload failed for image ${i}:`, uploadErr.message);
        }

        // Try full insert first; if optional columns are missing in the live DB, retry without them
        const fullRecord = {
          id: crypto.randomUUID(), post_id: postId, filename: f.filename,
          mimetype: f.mimetype, size: f.size, sort_order: i,
          storage_url: storageUrl, storage_path: storagePath, local_path: localPath,
          created_at: now
        };
        let { error: imgErr } = await sb.from('post_images').insert(fullRecord);

        // Graceful fallback: if DB doesn't have storage_path/local_path columns yet, insert without them
        if (imgErr && imgErr.code === 'PGRST204') {
          console.warn(`⚠️  Optional columns missing in post_images — inserting without storage_path/local_path. Run migration SQL to add them.`);
          const minimalRecord = {
            id: fullRecord.id, post_id: postId, filename: f.filename,
            mimetype: f.mimetype, size: f.size, sort_order: i,
            storage_url: storageUrl, created_at: now
          };
          ({ error: imgErr } = await sb.from('post_images').insert(minimalRecord));
        }

        if (imgErr) {
          console.error(`❌ post_images insert failed for image ${i}:`, imgErr.message, imgErr);
          throw new Error('Image save failed: ' + imgErr.message);
        }
        console.log(`✅ Image ${i} (${f.filename}) saved to post_images`);
      }
    } else {
      await run(`
        INSERT INTO posts (id, user_id, post_text, hashtags, intent, tone, ai_analysis, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `, [postId, req.user.id, result.postText, result.hashtags, intent, tone, result.analysis, now, now]);

      const safeFiles = req.files || [];
      console.log(`📝 Post ${postId} created (SQLite). Saving ${safeFiles.length} image(s)...`);

      for (let i = 0; i < safeFiles.length; i++) {
        const f = safeFiles[i];
        // Always store absolute path so we can find the file later
        const absPath = path.resolve(f.path);
        await run(`
          INSERT INTO post_images (id, post_id, filename, mimetype, size, sort_order, local_path, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [crypto.randomUUID(), postId, f.filename, f.mimetype, f.size, i, absPath, now]);
        console.log(`✅ Image ${i} (${f.filename}) saved at ${absPath}`);
      }
    }

    res.json({
      postId,
      postText:  result.postText,
      hashtags:  result.hashtags,
      analysis:  result.analysis,
      status:    'draft'
    });

  } catch (e) {
    // Clean up uploaded files on error
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    console.error('Generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
// ---- PUT /api/analyze/images/:postId/:index ----
// Replace a specific image in a draft post (for in-browser image editing)
router.put('/images/:postId/:index', requireAuth, upload.single('image'), async (req, res) => {
  const { postId, index } = req.params;
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'No image provided' });

  try {
    // Make sure user owns this post
    let postExists = false;
    if (IS_SUPABASE) {
      const { data } = await sb.from('posts').select('id').eq('id', postId).eq('user_id', req.user.id).single();
      postExists = !!data;
    } else {
      const p = await get('SELECT id FROM posts WHERE id = ? AND user_id = ?', [postId, req.user.id]);
      postExists = !!p;
    }
    if (!postExists) return res.status(404).json({ error: 'Post not found' });

    // Upload to storage
    let storageUrl = null, storagePath = null, localPath = f.path;
    try {
      const stored = await uploadImage(f.path, f.filename, f.mimetype);
      storageUrl  = stored.url;
      storagePath = stored.storagePath;
      localPath   = stored.localPath || f.path;
    } catch (e) { console.warn('Storage upload failed:', e.message); }

    const now = Math.floor(Date.now() / 1000);
    let existingImage;
    if (IS_SUPABASE) {
      const { data } = await sb.from('post_images').select('*').eq('post_id', postId).eq('sort_order', index).single();
      existingImage = data;
    } else {
      existingImage = await get('SELECT * FROM post_images WHERE post_id = ? AND sort_order = ?', [postId, index]);
    }

    if (existingImage) {
      try {
        if (existingImage.storage_path) await deleteImage(existingImage.storage_path);
        if (existingImage.local_path && fs.existsSync(existingImage.local_path)) fs.unlinkSync(existingImage.local_path);
      } catch (e) {}

      if (IS_SUPABASE) {
        await sb.from('post_images').update({
          filename: f.filename, mimetype: f.mimetype, size: f.size,
          storage_url: storageUrl, storage_path: storagePath, local_path: localPath
        }).eq('id', existingImage.id);
      } else {
        await run(`UPDATE post_images SET filename=?, mimetype=?, size=?, storage_url=?, storage_path=?, local_path=? WHERE id=?`, 
          [f.filename, f.mimetype, f.size, storageUrl, storagePath, localPath, existingImage.id]);
      }
    } else {
      if (IS_SUPABASE) {
        await sb.from('post_images').insert({
          id: crypto.randomUUID(), post_id: postId, filename: f.filename, mimetype: f.mimetype, size: f.size, sort_order: parseInt(index),
          storage_url: storageUrl, storage_path: storagePath, local_path: localPath, created_at: now
        });
      } else {
        await run(`INSERT INTO post_images (id, post_id, filename, mimetype, size, storage_url, storage_path, local_path, sort_order, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                   [crypto.randomUUID(), postId, f.filename, f.mimetype, f.size, storageUrl, storagePath, localPath, index, now]);
      }
    }

    res.json({ success: true, url: storageUrl || `/uploads/${f.filename}` });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// ---- POST /api/analyze/smart-schedule ----
// Given a list of draft post IDs, ask Gemini to suggest a posting schedule
router.post('/smart-schedule', requireAuth, async (req, res) => {
  const { postIds } = req.body;
  if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
    return res.status(400).json({ error: 'Provide an array of postIds' });
  }

  try {
    let settings = null;
    let posts = [];

    if (IS_SUPABASE) {
      const { data: sData } = await sb.from('user_settings').select('*').eq('user_id', req.user.id).single();
      settings = sData;

      const { data: pData } = await sb.from('posts')
        .select('*')
        .in('id', postIds)
        .eq('user_id', req.user.id);
      posts = pData || [];
    } else {
      settings = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
      posts = await all(
        `SELECT * FROM posts WHERE id IN (${postIds.map(() => '?').join(',')}) AND user_id = ?`,
        [...postIds, req.user.id]
      );
    }
    
    const postsPerWeek = settings?.posts_per_week || 3;

    if (posts.length === 0) return res.status(404).json({ error: 'No matching draft posts found' });

    // Get AI schedule suggestion
    const descriptions  = posts.map(p => p.ai_analysis || p.post_text.slice(0, 80));
    const today         = new Date().toISOString().split('T')[0];
    const suggestions   = await suggestSchedule(descriptions, postsPerWeek, today);

    // Get available time slots
    const slots = getNextPostingSlots(settings || { preferred_days: 'monday,wednesday,friday', preferred_time_hour: 9 }, posts.length + 5);

    // Build schedule result
    const schedule = posts.map((post, idx) => {
      let suggestedDate = null;
      if (suggestions && suggestions[idx]) {
        suggestedDate = suggestions[idx].suggestedDate;
      } else if (slots[idx]) {
        suggestedDate = slots[idx].toISOString().split('T')[0];
      }
      return {
        postId:        post.id,
        postPreview:   post.post_text.slice(0, 100) + '...',
        suggestedDate,
        reason:        suggestions?.[idx]?.reason || 'Optimal engagement time'
      };
    });

    res.json({ schedule });
  } catch (e) {
    console.error('Smart schedule error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
