// database/supabase.js
// Supabase client — used everywhere instead of SQLite in production
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role — never expose to frontend

if (!SUPABASE_URL || SUPABASE_URL === 'https://your-project-ref.supabase.co') {
  console.warn('⚠️  Supabase not configured. Using local SQLite fallback (dev only).');
}

// Service role client — bypasses RLS, safe for server-side use
const supabase = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_KEY || '', {
  auth: { autoRefreshToken: false, persistSession: false }
});

module.exports = supabase;
