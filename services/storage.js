// services/storage.js
// Supabase Storage for images — replaces local /uploads in production
const supabase = require('../database/supabase');
const fs       = require('fs');
const path     = require('path');

const BUCKET      = process.env.SUPABASE_STORAGE_BUCKET || 'post-images';
const IS_PROD     = process.env.NODE_ENV === 'production';
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

/**
 * Upload an image file to Supabase Storage (production)
 * or keep it on disk (local dev)
 *
 * @returns {{ url: string, storagePath: string|null, localPath: string|null }}
 */
async function uploadImage(localFilePath, filename, mimetype) {
  if (!IS_PROD) {
    // Dev: file is already on disk from multer, return local path
    return {
      url:         null,   // served via /uploads express static in dev
      storagePath: null,
      localPath:   localFilePath
    };
  }

  // Production: stream to Supabase Storage
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

  // Delete local temp file after Supabase upload
  try { fs.unlinkSync(localFilePath); } catch {}

  return {
    url:         data.publicUrl,
    storagePath,
    localPath:   null
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
