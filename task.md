# LinkedOutPro — Issue Audit & Fix Tracker

Audit completed: 2026-04-05  
All issues below have been **fixed**.

---

## 🔴 CRITICAL — Fixed

- [x] **`routes/analytics.js` — deprecated `v2/ugcPosts` API** (line 45)
  Replaced with the new `GET /rest/posts` REST Posts API. Also updated field mapping: `commentary` for post text, `publishedAt` for timestamp.

- [x] **`routes/analytics.js` — mismatched `LinkedIn-Version` header** (line 14)
  Changed from `202304` → `202603` to match the version used everywhere else in the app.

- [x] **`services/gemini.js` — text-only prompt template mentioned images when count=0** (line 115)
  Fixed conditional: now shows "Generate a post based solely on the context provided below." when no images are uploaded.

- [x] **`services/scheduler.js` — Infinite posting loop (Supabase)** (line 181)
  The `supabase.from('posts').update()` call natively swallows errors unless the `{ error }` property is explicitly checked. This caused the scheduler to falsely assume posts were marked as "published". The post remained "scheduled" in the DB, and the cron job picked it up and repushed it to LinkedIn every single minute. Added explicit error checking to break the loop and route failures to the catch handler.

- [x] **`services/scheduler.js` — Empty posts via Missing Image bypass** (line 160)
  When an image failed to download or was missing from the serverless `/tmp` directory, the code merely logged a warning and `continue`d, causing the script to upload a naked text-only post to LinkedIn. This is now a fatal throw, immediately aborting the post upload.

---

## 🟠 HIGH — Fixed

- [x] **`routes/posts.js` — `/bulk-schedule` route shadowed by `/:id` wildcard**
  Moved `POST /bulk-schedule` to be registered **before** all `/:id/*` routes so Express does not swallow "bulk-schedule" as a post ID. Also restored the accidentally removed `/:id/schedule` route that was displaced during the reorder.

- [x] **`routes/analyze.js` — `req.files` accessed without null guard on text-only requests**
  Added `const safeFiles = req.files || []` in both Supabase and SQLite branches; loops now iterate over `safeFiles` instead of `req.files` directly. Multer sets `req.files` to `undefined` (not `[]`) when no files match.

- [x] **`routes/analyze.js` — inline `require()` calls inside routes**
  Moved `IS_SUPABASE`, `supabase`, `uploadImage`, `deleteImage` to top-level imports; removed all inline requires in `/generate`, `/images/:postId/:index`, and `/smart-schedule` handlers.

- [x] **`middleware/auth.js` — insecure JWT fallback secret silently used in production**
  Added a startup guard: if `NODE_ENV === 'production'` and `JWT_SECRET` is not set, the process now exits with a clear fatal error instead of using the weak fallback.

- [x] **`routes/cron.js` — `/debug` endpoint unauthenticated**
  Added `requireCronSecret` middleware to `GET /api/cron/debug`, which lists all scheduled/failed posts, user names and token expiry. It now requires the same `X-Cron-Secret` header as `/trigger`.

- [x] **`services/scheduler.js` — typo in comment** (line 282)
  `Determnistic` → `Deterministic`.

---

## 🟡 MEDIUM — Fixed

- [x] **`routes/settings.js` — repeated `require('../database/db')` inside every handler**
  Moved `IS_SUPABASE` and `supabase` to the single top-level import; removed the three redundant inline requires.

- [x] **`package.json` — `express-session` listed but never used**
  Removed from dependencies. The app uses JWT + httpOnly cookies exclusively.

---

## 🟢 LOW / POLISH — Fixed

- [x] **`README.md` was empty (16 bytes)**
  Written from scratch with full setup guide, env variable table, API overview, and deployment notes.