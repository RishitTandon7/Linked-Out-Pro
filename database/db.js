// database/db.js — Unified DB adapter
// Uses Supabase (Postgres) in production, SQLite in development
// Exports the same `run`, `get`, `all`, `initSchema` interface regardless of backend

const IS_SUPABASE = process.env.SUPABASE_URL &&
  process.env.SUPABASE_URL !== 'https://your-project-ref.supabase.co';

// ========================================================
//  SUPABASE (production — hosted Postgres via REST)
// ========================================================
if (IS_SUPABASE) {
  const supabase = require('./supabase');

  // Thin wrappers that translate our SQL-based calls to Supabase client calls.
  // For complex JOINs we use supabase.rpc() or raw queries via POST.
  // But for simplicity we expose the supabase client directly and let
  // the routes/services call it. The helpers below exist so existing code
  // that already uses run/get/all still works during migration.

  async function run(sql, params = []) {
    // We don't execute raw SQL against Supabase REST.
    // This function is only used for writes — the routes should be migrated
    // to use supabase directly. For now it's a no-op shim.
    console.warn('[db.run] Raw SQL not supported on Supabase REST. Use supabase client directly.');
    return { lastID: null, changes: 0 };
  }

  async function get(sql, params = []) {
    console.warn('[db.get] Raw SQL not supported on Supabase REST. Use supabase client directly.');
    return null;
  }

  async function all(sql, params = []) {
    console.warn('[db.all] Raw SQL not supported on Supabase REST. Use supabase client directly.');
    return [];
  }

  async function initSchema() {
    // Schema is managed via Supabase migrations — no runtime schema creation
    console.log('✅ Supabase connected:', process.env.SUPABASE_URL);
  }

  module.exports = { supabase, run, get, all, initSchema, IS_SUPABASE: true };

// ========================================================
//  SQLITE (local development)
// ========================================================
} else {
  const sqlite3 = require('sqlite3').verbose();
  const path    = require('path');
  const fs      = require('fs');

  const DB_PATH = process.env.DB_PATH || './data/linkedoutpro.db';
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error('❌ DB open error:', err.message); process.exit(1); }
    console.log('✅ SQLite connected:', DB_PATH);
  });

  db.serialize(() => {
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA foreign_keys=ON');
  });

  const run = (sql, params = []) => new Promise((res, rej) =>
    db.run(sql, params, function(e) { if (e) rej(e); else res({ lastID: this.lastID, changes: this.changes }); })
  );
  const get = (sql, params = []) => new Promise((res, rej) =>
    db.get(sql, params, (e, row) => e ? rej(e) : res(row))
  );
  const all = (sql, params = []) => new Promise((res, rej) =>
    db.all(sql, params, (e, rows) => e ? rej(e) : res(rows))
  );

  async function initSchema() {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id             TEXT PRIMARY KEY,
        linkedin_id    TEXT UNIQUE NOT NULL,
        name           TEXT NOT NULL,
        email          TEXT,
        headline       TEXT,
        avatar_url     TEXT,
        access_token   TEXT NOT NULL,
        token_expires  INTEGER,
        fcm_token      TEXT,
        created_at     INTEGER DEFAULT (unixepoch()),
        updated_at     INTEGER DEFAULT (unixepoch())
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS posts (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL,
        post_text        TEXT NOT NULL,
        hashtags         TEXT DEFAULT '',
        intent           TEXT DEFAULT 'achievement',
        tone             TEXT DEFAULT 'professional',
        ai_analysis      TEXT,
        status           TEXT DEFAULT 'draft',
        scheduled_at     INTEGER,
        published_at     INTEGER,
        linkedin_post_id TEXT,
        fail_reason      TEXT,
        created_at       INTEGER DEFAULT (unixepoch()),
        updated_at       INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS post_images (
        id          TEXT PRIMARY KEY,
        post_id     TEXT NOT NULL,
        filename    TEXT NOT NULL,
        mimetype    TEXT,
        size        INTEGER,
        storage_url TEXT,
        storage_path TEXT,
        local_path  TEXT,
        sort_order  INTEGER DEFAULT 0,
        created_at  INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);
    // Safe migration: add columns if they don't exist yet (for existing DBs)
    await run(`ALTER TABLE post_images ADD COLUMN storage_path TEXT`).catch(() => {});
    await run(`ALTER TABLE post_images ADD COLUMN local_path TEXT`).catch(() => {});

    await run(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id                   TEXT PRIMARY KEY,
        user_id              TEXT UNIQUE NOT NULL,
        auto_post_enabled    INTEGER DEFAULT 1,
        posts_per_week       INTEGER DEFAULT 3,
        preferred_days       TEXT DEFAULT 'monday,wednesday,friday',
        preferred_time_hour  INTEGER DEFAULT 9,
        auto_schedule_new    INTEGER DEFAULT 1,
        default_intent       TEXT DEFAULT 'achievement',
        default_tone         TEXT DEFAULT 'professional',
        updated_at           INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Database schema ready');
  }

  module.exports = { db, run, get, all, initSchema, IS_SUPABASE: false };
}
