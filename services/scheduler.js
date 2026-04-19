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
const UPLOADS_DIR    = process.env.VERCEL ? os.tmpdir() : (process.env.UPLOADS_DIR || './uploads');
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'post-images';

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
  console.log('🕐 Post scheduler started (checks every minute)');

  cron.schedule('* * * * *', async () => {
    await publishDuePosts();
  });

  // Also run immediately on startup
  setTimeout(publishDuePosts, 3000);
}

/**
 * Find and publish all posts whose scheduled_at has passed
 */
async function publishDuePosts() {
  const result = { published: 0, failed: 0, skipped: 0, postsFound: 0, errors: [], nowTs: 0 };

  try {
    const now = Math.floor(Date.now() / 1000);
    result.nowTs = now;
    let duePosts = [];

    if (IS_SUPABASE) {
      const { data: posts, error: postsErr } = await sb.from('posts')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_at', now);

      if (postsErr) result.errors.push('posts_query: ' + postsErr.message);
      if (!posts || posts.length === 0) {
        // Also grab total scheduled count for debugging
        const { data: allSched } = await sb.from('posts').select('id,scheduled_at').eq('status','scheduled');
        result.totalScheduled = (allSched || []).length;
        result.nextScheduled  = allSched?.map(p => p.scheduled_at) || [];
        return result;
      }

      result.postsFound = posts.length;
      const userIds = [...new Set(posts.map(p => p.user_id))];
      
      const { data: users, error: usersErr } = await sb.from('users')
        .select('id, access_token, linkedin_id')
        .in('id', userIds);
      if (usersErr) result.errors.push('users_query: ' + usersErr.message);

      const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));
      // CRITICAL: only copy specific user fields — do NOT spread the whole user object
      // because user.id would overwrite post.id, causing all DB updates to use the wrong ID
      duePosts = posts.map(p => {
        const u = userMap[p.user_id] || {};
        return { ...p, access_token: u.access_token, linkedin_id: u.linkedin_id };
      });
        
    } else {
      duePosts = await all(`
        SELECT p.*, u.access_token, u.linkedin_id
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.status = 'scheduled' AND p.scheduled_at <= ?
      `, [now]);
      result.postsFound = duePosts.length;
    }

    if (duePosts.length === 0) return result;

    console.log(`🚀 Publishing ${duePosts.length} scheduled post(s)...`);

    for (const post of duePosts) {
      const ok = await publishSinglePost(post, result.errors);
      if (ok) result.published++; else result.failed++;
    }
  } catch (e) {
    result.errors.push('scheduler: ' + e.message);
    console.error('Scheduler error:', e.message);
  }

  return result;
}

/**
 * Publish a single post to LinkedIn, then delete its images to free storage
 * @returns {boolean} success
 */
async function publishSinglePost(post, errorsArr = []) {
  try {
    let images = [];
    if (IS_SUPABASE) {
      const { data, error: imgErr } = await sb.from('post_images').select('*').eq('post_id', post.id).order('sort_order');
      if (imgErr) errorsArr.push(`post_images(${post.id}): ${imgErr.message}`);
      images = data || [];
    } else {
      images = await all('SELECT * FROM post_images WHERE post_id = ? ORDER BY sort_order', [post.id]);
    }

    const imageFiles = [];
    for (const img of images) {
      // ─ Prefer: generate a fresh signed URL from storage_path (works on private or public buckets)
      if (IS_SUPABASE && img.storage_path) {
        try {
          const { data: signed, error: signErr } = await sb.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(img.storage_path, 120);  // 2-min expiry

          if (signErr || !signed?.signedUrl) {
            throw new Error(signErr?.message || 'Signed URL generation returned no URL');
          }

          const axios   = require('axios');
          const resp    = await axios.get(signed.signedUrl, { responseType: 'arraybuffer' });
          const tmpPath = path.join(os.tmpdir(), img.filename || `img_${img.id}`);
          fs.writeFileSync(tmpPath, resp.data);
          console.log(`📥 Image downloaded via signed URL: ${img.filename} (${resp.data.byteLength} bytes)`);
          imageFiles.push({ path: tmpPath, mimetype: img.mimetype });
          continue;
        } catch (dlErr) {
          // Hard fail so the post is marked 'failed' rather than published without images
          throw new Error(`Image download failed for ${img.filename}: ${dlErr.message}`);
        }
      }

      // ─ Fallback: try public storage_url (no Supabase, or no storage_path)
      if (img.storage_url && !fs.existsSync(getLocalPath(img))) {
        try {
          const axios   = require('axios');
          const resp    = await axios.get(img.storage_url, { responseType: 'arraybuffer' });
          const tmpPath = path.join(os.tmpdir(), img.filename || `img_${img.id}`);
          fs.writeFileSync(tmpPath, resp.data);
          console.log(`📥 Image downloaded via public URL: ${img.filename}`);
          imageFiles.push({ path: tmpPath, mimetype: img.mimetype });
          continue;
        } catch (dlErr) {
          throw new Error(`Image download failed (public URL) for ${img.filename}: ${dlErr.message}`);
        }
      }

      // ─ Last resort: local disk path (dev without Supabase storage)
      let filePath = getLocalPath(img);
      if (!path.isAbsolute(filePath)) filePath = path.resolve(filePath);

      if (!fs.existsSync(filePath) && img.filename) {
        const fallback = path.join(path.resolve(UPLOADS_DIR), img.filename);
        if (fs.existsSync(fallback)) filePath = fallback;
      }

      if (!fs.existsSync(filePath)) {
        throw new Error(`Image ${img.filename} missing from disk and no cloud storage path. Aborting.`);
      }

      console.log(`📸 Attaching local image: ${filePath}`);
      imageFiles.push({ path: filePath, mimetype: img.mimetype });
    }

    console.log(`📤 Publishing post ${post.id} with ${imageFiles.length}/${images.length} image(s)...`);
    console.log(`📏 post_text length going to LinkedIn: ${post.post_text?.length} chars`);

    const linkedinPostId = await publishPost(
      post.access_token,
      post.linkedin_id,
      post.post_text,
      post.hashtags,
      imageFiles
    );

    const now = Math.floor(Date.now() / 1000);
    if (IS_SUPABASE) {
      const { error: updErr } = await sb.from('posts').update({
        status: 'published', published_at: now, linkedin_post_id: linkedinPostId, updated_at: now
      }).eq('id', post.id);
      if (updErr) {
        throw new Error(`CRITICAL: Published to LinkedIn (${linkedinPostId}) but DB update failed: ${updErr.message}`);
      }
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

    try { await notifyPostPublished(post.user_id, post.id); } catch (err) { /* silent */ }

    return true;

  } catch (e) {
    const errMsg = e.message || String(e);
    errorsArr.push(`publish(${post.id}): ${errMsg}`);
    console.error(`❌ Failed to publish post ${post.id}:`, errMsg);
    console.error(`❌ Full error:`, e.response?.data || e.stack || errMsg);

    const now = Math.floor(Date.now() / 1000);

    // ── DUPLICATE_POST: LinkedIn already has this post (from a prior run that published
    //    successfully but then failed to update the DB status).
    //    Mark it as 'published' so the cron stops retrying it forever.
    const isDuplicate = errMsg.includes('DUPLICATE_POST') ||
                        errMsg.includes('duplicate') ||
                        errMsg.includes('Duplicate');

    if (isDuplicate) {
      console.warn(`⚠️  DUPLICATE_POST for post ${post.id} — already on LinkedIn. Marking as published.`);
      try {
        const dupId = e.response?.data?.value?.id ||
                      e.response?.headers?.['x-restli-id'] ||
                      'duplicate_recovered';
        if (IS_SUPABASE) {
          await sb.from('posts').update({
            status: 'published', published_at: now, linkedin_post_id: dupId, updated_at: now
          }).eq('id', post.id);
        } else {
          await run(`UPDATE posts SET status='published', published_at=?, linkedin_post_id=?, updated_at=? WHERE id=?`,
            [now, dupId, now, post.id]);
        }
        console.log(`✅ Post ${post.id} recovered and marked as published (was a duplicate)`);
        return true;
      } catch (dbErr) {
        console.error(`⚠️ Could not recover duplicate post ${post.id}:`, dbErr.message);
      }
    }

    // CRITICAL: wrap this update in its own try-catch.
    // If the DB update itself fails, we must still return false (not re-throw),
    // otherwise the post stays 'scheduled' and will be retried forever.
    try {
      if (IS_SUPABASE) {
        const { error: updateErr } = await sb.from('posts')
          .update({ status: 'failed', fail_reason: errMsg.slice(0, 500), updated_at: now })
          .eq('id', post.id);
        if (updateErr) {
          console.error(`⚠️ Could not mark post ${post.id} as failed:`, updateErr.message);
        } else {
          console.log(`🏷️  Post ${post.id} marked as failed in DB`);
        }
      } else {
        await run(`UPDATE posts SET status='failed', fail_reason=?, updated_at=? WHERE id=?`,
          [errMsg.slice(0, 500), now, post.id]);
        console.log(`🏷️  Post ${post.id} marked as failed in DB`);
      }
    } catch (dbErr) {
      console.error(`⚠️ CRITICAL: Could not mark post ${post.id} as failed in DB:`, dbErr.message);
    }

    try { await notifyPostFailed(post.user_id, errMsg); } catch (err) { /* silent */ }
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
        // Deterministic random based on date
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
