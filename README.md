# LinkedOut Pro

AI-powered LinkedIn post generator and scheduler.

## Features

- **AI Post Generation** — Upload photos and let Gemini Vision write a polished LinkedIn post
- **Smart Scheduling** — AI-suggested posting windows based on your preferred days/times
- **Auto-Publishing** — Posts publish automatically via cron (GitHub Actions in prod, node-cron in dev)
- **Push Notifications** — Firebase Cloud Messaging alerts when posts publish or fail
- **Multi-image support** — Up to 9 images per post via LinkedIn's REST Images API
- **PWA** — Installable as a Progressive Web App

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express 5 |
| Database | SQLite (dev) / Supabase Postgres (prod) |
| AI | Google Gemini 2.5 Flash |
| Image Storage | Supabase Storage |
| LinkedIn API | REST Posts API (`202603`) |
| Auth | LinkedIn OAuth 2.0 + Google OAuth 2.0 + JWT |
| Hosting | Vercel (serverless) |

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start the development server (hot-reload via --watch)
npm run dev

# App runs at: http://localhost:3000
# Dashboard:   http://localhost:3000/dashboard
```

## Environment Variables

See `.env.example` for the full list. Required variables:

| Variable | Description |
|----------|-------------|
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth App Client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth App Client Secret |
| `LINKEDIN_CALLBACK_URL` | e.g. `http://localhost:3000/api/auth/linkedin/callback` |
| `GEMINI_API_KEY_1` | Google Gemini API key |
| `JWT_SECRET` | Random secret for signing JWTs (min 32 chars) |
| `SUPABASE_URL` | Supabase project URL (optional — falls back to SQLite) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (optional) |
| `CRON_SECRET` | Secret header value for the `/api/cron/trigger` endpoint |

## Production Deployment (Vercel)

1. Push to GitHub and connect the repo to Vercel
2. Set all env vars in the Vercel dashboard
3. Add a GitHub Actions workflow (`.github/workflows/cron.yml`) to hit `/api/cron/trigger` on a schedule with the `CRON_SECRET` header

## API Overview

| Route | Description |
|-------|-------------|
| `GET  /api/auth/linkedin` | Start LinkedIn OAuth |
| `GET  /api/auth/google` | Start Google OAuth |
| `GET  /api/auth/me` | Current user info |
| `POST /api/analyze/generate` | Upload images + generate post with Gemini |
| `GET  /api/posts` | List user's posts |
| `POST /api/posts/:id/schedule` | Schedule a post |
| `POST /api/posts/bulk-schedule` | Bulk-schedule multiple posts |
| `POST /api/posts/:id/publish-now` | Publish immediately |
| `GET  /api/analytics/live` | Real LinkedIn engagement data |
| `GET  /api/cron/trigger` | Trigger the scheduler (cron/GitHub Actions) |
| `GET  /api/cron/debug` | Debug scheduled/failed posts (requires CRON_SECRET) |

## License

ISC