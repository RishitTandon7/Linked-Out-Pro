// services/storage.js
// Supabase Storage for images — replaces local /uploads in production
const supabase = require('../database/supabase');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const BUCKET      = process.env.SUPABASE_STORAGE_BUCKET || 'post-images';
const UPLOADS_DIR = process.env.VERCEL ? os.tmpdir() : (process.env.UPLOADS_DIR || './uploads');

// Use Supabase Storage whenever Supabase is configured — regardless of NODE_ENV.
// This ensures local dev with Supabase also has images in cloud storage,
// so they're accessible when Vercel publishes the post.
const USE_SUPABASE_STORAGE = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_URL !== 'https://your-project-ref.supabase.co' &&
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Upload an image file to Supabase Storage (when Supabase is configured)
 * or keep it on disk (pure local dev without Supabase)
 *
 * @returns {{ url: string|null, storagePath: string|null, localPath: string }}
 */
async function uploadImage(localFilePath, filename, mimetype) {
  if (!USE_SUPABASE_STORAGE) {
    // Pure local dev (no Supabase): file stays on disk only
    return {
      url:         null,
      storagePath: null,
      localPath:   path.resolve(localFilePath)
    };
  }

  // Supabase configured: upload so the image is reachable from Vercel at publish time
  const fileBuffer  = fs.readFileSync(localFilePath);
  const storagePath = `posts/${Date.now()}_${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType:  mimetype || 'image/jpeg',
      cacheControl: '3600',
      upsert:       false
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  // Get public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return {
    url:         data.publicUrl,
    storagePath,
    localPath:   path.resolve(localFilePath)  // absolute local path as fast fallback
  };
}

/**
 * Delete an image from Supabase Storage
 */
async function deleteImage(storagePath) {
  if (!storagePath) return;
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

/**
 * Get the usable URL for an image
 * In dev: use local path; in prod: use Supabase URL
 */
function getImageUrl(imageRow) {
  if (imageRow.storage_url) return imageRow.storage_url;
  // Local dev — Express serves /uploads statically
  return `/uploads/${imageRow.filename}`;
}

/**
 * Get local file path for an image (for Gemini analysis or LinkedIn upload)
 */
function getLocalPath(imageRow) {
  if (imageRow.local_path) return imageRow.local_path;
  return path.join(UPLOADS_DIR, imageRow.filename);
}

module.exports = { uploadImage, deleteImage, getImageUrl, getLocalPath };
