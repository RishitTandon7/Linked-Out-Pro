// services/scheduler.js — Cron-based auto-publisher
// In dev: runs node-cron every 5 min
// In prod (Vercel): cron is disabled — GitHub Actions calls /api/cron/trigger instead

const { IS_SUPABASE, supabase: sb, run, all } = require('../database/db');
const { publishPost } = require('./linkedin');
const { getLocalPath, deleteImage } = require('./storage');
const { notifyPostPublished, notifyPostFailed } = require('./notifications');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const UPLOADS_DIR = process.env.VERCEL ? os.tmpdir() : (process.env.UPLOADS_DIR || './uploads');

const IS_VERCEL = process.env.VERCEL === '1';
let schedulerRunning = false;

/**
 * Start the local cron scheduler (dev/non-serverless only)
 */
function startScheduler() {
  if (schedulerRunning || IS_VERCEL) {
    if (IS_VERCEL) console.log('☁️  Vercel detected — cron disabled (use GitHub Actions)');
    return;
  }
  schedulerRunning = true;

  const cron = require('node-cron');
  console.log('🕐 Post scheduler started (checks every 5 minutes)');

  cron.schedule('*/5 * * * *', async () => {
    await publishDuePosts();
  });

  // Also run immediately on startup
  setTimeout(publishDuePosts, 3000);
}

/**
 * Find and publish all posts whose scheduled_at has passed
 */
async function publishDuePosts() {
  const result = { published: 0, failed: 0, skipped: 0 };

  try {
    const now = Math.floor(Date.now() / 1000);
    let duePosts = [];

    if (IS_SUPABASE) {
      // Join posts + users via two queries
      const { data: posts } = await sb.from('posts')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_at', now);

      if (!posts || posts.length === 0) return result;

      const userIds = [...new Set(posts.map(p => p.user_id))];
      
      // Get users
      const { data: users } = await sb.from('users')
        .select('id, access_token, linkedin_id')
        .in('id', userIds);
        
      // Get settings to check auto_post_enabled
      const { data: settings } = await sb.from('user_settings')
        .select('user_id, auto_post_enabled')
        .in('user_id', userIds);

      const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));
      const settingsMap = Object.fromEntries((settings || []).map(s => [s.user_id, s.auto_post_enabled]));

      duePosts = posts
        .filter(p => settingsMap[p.user_id] !== false) // Only map if auto-post is enabled
        .map(p => ({ ...p, ...userMap[p.user_id] }));
        
    } else {
      duePosts = await all(`
        SELECT p.*, u.access_token, u.linkedin_id
        FROM posts p
        JOIN users u ON p.user_id = u.id
        JOIN user_settings s ON p.user_id = s.user_id
        WHERE p.status = 'scheduled' AND p.scheduled_at <= ? AND s.auto_post_enabled = 1
      `, [now]);
    }

    if (duePosts.length === 0) return result;

    console.log(`🚀 Publishing ${duePosts.length} scheduled post(s)...`);

    for (const post of duePosts) {
      const ok = await publishSinglePost(post);
      if (ok) result.published++; else result.failed++;
    }
  } catch (e) {
    console.error('Scheduler error:', e.message);
  }

  return result;
}

/**
 * Publish a single post to LinkedIn, then delete its images to free storage
 * @returns {boolean} success
 */
async function publishSinglePost(post) {
  try {
    let images = [];
    if (IS_SUPABASE) {
      const { data } = await sb.from('post_images').select('*').eq('post_id', post.id).order('sort_order');
      images = data || [];
    } else {
      images = await all('SELECT * FROM post_images WHERE post_id = ? ORDER BY sort_order', [post.id]);
    }

    const imageFiles = [];
    for (const img of images) {
      let filePath = getLocalPath(img);

      // Resolve relative paths (e.g. './uploads/abc.jpg') to absolute
      if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(filePath);
      }

      // Fallback: try UPLOADS_DIR + filename if the original path is missing
      if (!fs.existsSync(filePath) && img.filename) {
        const fallback = path.join(path.resolve(UPLOADS_DIR), img.filename);
        if (fs.existsSync(fallback)) {
          filePath = fallback;
          console.log(`📁 Using fallback path for image ${img.filename}`);
        }
      }

      // On Vercel, /tmp files from a previous invocation may be gone.
      // Re-download from Supabase Storage if the local file is missing.
      if (!fs.existsSync(filePath)) {
        const url = img.storage_url;
        if (!url) {
          console.warn(`⚠️ Image ${img.id} (${img.filename}) has no storage_url and local file missing (checked: ${filePath}) — skipping`);
          continue;
        }
        try {
          const axios = require('axios');
          const resp  = await axios.get(url, { responseType: 'arraybuffer' });
          filePath = path.join(os.tmpdir(), img.filename || `img_${img.id}`);
          fs.writeFileSync(filePath, resp.data);
          console.log(`📥 Re-downloaded image from Supabase Storage: ${img.filename}`);
        } catch (dlErr) {
          console.warn(`⚠️ Could not download image ${img.id}:`, dlErr.message);
          continue;
        }
      }

      console.log(`📸 Attaching image to LinkedIn post: ${filePath}`);
      imageFiles.push({ path: filePath, mimetype: img.mimetype });
    }

    const linkedinPostId = await publishPost(
      post.access_token,
      post.linkedin_id,
      post.post_text,
      post.hashtags,
      imageFiles
    );

    const now = Math.floor(Date.now() / 1000);
    if (IS_SUPABASE) {
      await sb.from('posts').update({
        status: 'published', published_at: now, linkedin_post_id: linkedinPostId, updated_at: now
      }).eq('id', post.id);
    } else {
      await run(`UPDATE posts SET status='published', published_at=?, linkedin_post_id=?, updated_at=? WHERE id=?`,
        [now, linkedinPostId, now, post.id]);
    }

    console.log(`✅ Post ${post.id} published to LinkedIn (${linkedinPostId})`);

    // Clean up images
    let deleted = 0;
    for (const img of images) {
      try {
        if (img.storage_path) {
          await deleteImage(img.storage_path);
        } else {
          const p = getLocalPath(img);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        if (IS_SUPABASE) {
          await sb.from('post_images').delete().eq('id', img.id);
        } else {
          await run('DELETE FROM post_images WHERE id = ?', [img.id]);
        }
        deleted++;
      } catch (e) {
        console.warn(`⚠️  Could not delete image ${img.id}:`, e.message);
      }
    }
    if (deleted > 0) console.log(`🗑️  Deleted ${deleted} image(s) — storage freed`);

    // Trigger success notification
    try {
      await notifyPostPublished(post.user_id, post.id);
    } catch (err) { console.warn('Could not send success push:', err.message); }

    return true;

  } catch (e) {
    console.error(`❌ Failed to publish post ${post.id}:`, e.message);
    const now = Math.floor(Date.now() / 1000);
    if (IS_SUPABASE) {
      await sb.from('posts').update({ status: 'failed', fail_reason: e.message, updated_at: now }).eq('id', post.id);
    } else {
      await run(`UPDATE posts SET status='failed', fail_reason=?, updated_at=? WHERE id=?`, [e.message, now, post.id]);
    }

    // Trigger failure notification
    try {
      await notifyPostFailed(post.user_id, e.message);
    } catch (err) { console.warn('Could not send error push:', err.message); }

    return false;
  }
}

/**
 * Calculate next N posting windows for a user based on their settings
 */
function getNextPostingSlots(settings, count = 10) {
  const dayMap = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const preferredDays = (settings.preferred_days || 'monday,wednesday,friday')
    .split(',')
    .map(d => dayMap[d.trim().toLowerCase()])
    .filter(d => d !== undefined)
    .sort();

  const isAgentDecide = settings.preferred_time_hour === -1;
  const hour = isAgentDecide ? 9 : (settings.preferred_time_hour || 9);
  
  const slots = [];
  const now = new Date();
  let cursor = new Date(now);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(hour);
  if (cursor <= now) cursor.setDate(cursor.getDate() + 1);

  let safety = 0;
  while (slots.length < count && safety < 60) {
    safety++;
    if (preferredDays.includes(cursor.getDay())) {
      if (isAgentDecide) {
        // High engagement hours: 8am, 9am, 11am, 12pm, 3pm, 5pm
        const optimalHours = [8, 9, 11, 12, 15, 17];
        // Determnistic random based on date
        const randHour = optimalHours[(cursor.getDate() + cursor.getMonth() + slots.length) % optimalHours.length];
        cursor.setHours(randHour);
      }
      slots.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}

module.exports = { startScheduler, publishDuePosts, publishSinglePost, getNextPostingSlots };
