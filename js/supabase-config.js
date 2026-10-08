// ---------------------------------------------------------------------------
// Supabase connection — PUBLIC values only.
//
// The URL and the "anon" key are safe to ship in the browser: they grant NO
// special access on their own. Every table is protected by Row Level Security
// (see supabase/migrations/001_schema.sql), so the anon key can only do what the logged-in
// user is allowed to do.
//
// NEVER put the service_role key here. That one bypasses RLS and belongs only
// in server-side secrets (the Mail.ru edge function), never in the browser.
//
// Fill these in after creating your project at https://supabase.com
//   Supabase dashboard → Project Settings → API
// ---------------------------------------------------------------------------
window.SAM_SUPABASE = {
  url: 'https://kxbxbjkcvoeuyqyztqmw.supabase.co',
  // Publishable key — safe in the browser: RLS (see supabase/migrations/001_schema.sql) is what
  // actually protects the data. The secret key is NEVER placed here.
  anonKey: 'sb_publishable_KC5fmQvydoqsU4pUrWzMNg_jDuKWg7D',
};

// supabase-js is served from this site (js/vendor/, see js/vendor/README.md) and loaded by
// the page before this file; create the shared client once.
window.sb = window.supabase.createClient(
  window.SAM_SUPABASE.url,
  window.SAM_SUPABASE.anonKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
