-- =======================================================
--  LinkedOut Pro — Supabase PostgreSQL Schema
--
--  Run this in: Supabase Dashboard → SQL Editor → New Query
--  This creates all tables + RLS policies + storage bucket
-- =======================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_id    TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  email          TEXT,
  headline       TEXT,
  avatar_url     TEXT,
  access_token   TEXT NOT NULL,
  token_expires  BIGINT,
  fcm_token      TEXT,
  created_at     BIGINT DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT),
  updated_at     BIGINT DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT)
);

-- 2. POSTS TABLE
CREATE TABLE IF NOT EXISTS posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_text        TEXT NOT NULL,
  hashtags         TEXT DEFAULT '',
  intent           TEXT DEFAULT 'achievement',
  tone             TEXT DEFAULT 'professional',
  ai_analysis      TEXT,
  status           TEXT DEFAULT 'draft',  -- draft | scheduled | published | failed
  scheduled_at     BIGINT,
  published_at     BIGINT,
  linkedin_post_id TEXT,
  fail_reason      TEXT,
  created_at       BIGINT DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT),
  updated_at       BIGINT DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT)
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(status, scheduled_at);

-- 3. POST IMAGES TABLE
CREATE TABLE IF NOT EXISTS post_images (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mimetype     TEXT,
  size         INTEGER,
  storage_url  TEXT,             -- Supabase Storage public URL
  storage_path TEXT,             -- Supabase Storage internal path (for deletion)
  local_path   TEXT,             -- Absolute local file path (dev fallback)
  sort_order   INTEGER DEFAULT 0,
  created_at   BIGINT DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT)
);

-- Safe migration for existing databases
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS local_path TEXT;

CREATE INDEX IF NOT EXISTS idx_post_images_post_id ON post_images(post_id);

-- 4. USER SETTINGS TABLE
CREATE TABLE IF NOT EXISTS user_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auto_post_enabled    BOOLEAN DEFAULT FALSE,
  posts_per_week       INTEGER DEFAULT 3,
  preferred_days       TEXT DEFAULT 'monday,wednesday,friday',
  preferred_time_hour  INTEGER DEFAULT 9,
  auto_schedule_new    BOOLEAN DEFAULT TRUE,
  default_intent       TEXT DEFAULT 'achievement',
  default_tone         TEXT DEFAULT 'professional',
  updated_at           BIGINT DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT)
);

-- 5. ROW LEVEL SECURITY (RLS)
-- Our backend uses the service_role key which bypasses RLS,
-- but these policies protect against accidental direct client access.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (default)
-- No anon/authenticated policies — all access is server-side via service key

-- 6. STORAGE BUCKET
-- Create the storage bucket for post images
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for post images
CREATE POLICY "Public read access for post images"
ON storage.objects FOR SELECT
USING (bucket_id = 'post-images');

-- Service role can upload/delete (handled automatically by service key)

-- ✅ Done!
SELECT 'LinkedOut Pro schema created successfully!' AS status;
