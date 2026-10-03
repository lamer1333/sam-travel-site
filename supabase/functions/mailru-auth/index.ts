// ============================================================================
// Mail.ru → Supabase auth bridge  (Supabase Edge Function, Deno)
// ----------------------------------------------------------------------------
// Mail.ru is NOT a built-in Supabase OAuth provider, so we bridge it ourselves:
//
//   1. /mailru-auth/start  → send the user to Mail.ru's consent screen
//   2. Mail.ru redirects back here with ?code=...
//   3. We swap the code for the user's email
//   4. We find-or-create that user in Supabase (service_role, server-side only)
//   5. We mint a magic link and bounce the browser through it → logged in
//
// Secrets to set (Supabase → Edge Functions → Secrets), NEVER in the browser:
//   MAILRU_CLIENT_ID
//   MAILRU_CLIENT_SECRET
//   MAILRU_REDIRECT_URI      = https://<project>.functions.supabase.co/mailru-auth
//   SB_URL                   = https://<project>.supabase.co
//   SB_SERVICE_ROLE_KEY      = <service_role key>   ← bypasses RLS; keep secret
//   SITE_URL                 = https://samtravel.am
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID     = Deno.env.get('MAILRU_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('MAILRU_CLIENT_SECRET')!;
const REDIRECT_URI  = Deno.env.get('MAILRU_REDIRECT_URI')!;
const SB_URL        = Deno.env.get('SB_URL')!;
const SERVICE_KEY   = Deno.env.get('SB_SERVICE_ROLE_KEY')!;
const SITE_URL      = Deno.env.get('SITE_URL') || '';

const admin = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}
function safeReturn(raw: string | null): string {
  // Only allow returning to our own site — never an attacker-supplied URL.
  const fallback = (SITE_URL || '') + '/cabinet.html';
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (SITE_URL && u.origin === new URL(SITE_URL).origin) return u.toString();
  } catch (_) { /* ignore */ }
  return fallback;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  // ---- Step 1: start — no code yet → send to Mail.ru -----------------------
  if (!code) {
    const returnTo = safeReturn(url.searchParams.get('redirect_to'));
    const auth = new URL('https://oauth.mail.ru/login');
    auth.searchParams.set('client_id', CLIENT_ID);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', 'userinfo');
    auth.searchParams.set('redirect_uri', REDIRECT_URI);
    auth.searchParams.set('state', btoa(returnTo)); // carry the return URL through
    return redirect(auth.toString());
  }

  // ---- Step 2: callback — exchange the code for an access token ------------
  const returnTo = safeReturn((() => {
    try { return atob(url.searchParams.get('state') || ''); } catch { return null; }
  })());

  try {
    const tokenRes = await fetch('https://oauth.mail.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error('Mail.ru token exchange failed');

    // ---- Step 3: fetch the user's profile (email is what we need) ----------
    const infoRes = await fetch('https://oauth.mail.ru/userinfo?access_token=' + token.access_token);
    const info = await infoRes.json();
    const email = (info.email || '').toLowerCase();
    if (!email) throw new Error('Mail.ru did not return an email');
    const fullName = info.name || [info.first_name, info.last_name].filter(Boolean).join(' ');

    // ---- Step 4: find-or-create the Supabase user --------------------------
    // createUser is idempotent enough for us: if the email exists it errors,
    // and we just carry on to mint the login link.
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, provider: 'mailru' },
    }).catch(() => { /* already exists — fine */ });

    // ---- Step 5: mint a magic link and bounce the browser through it -------
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: returnTo },
    });
    if (error || !data?.properties?.action_link) {
      throw error || new Error('Could not generate login link');
    }
    return redirect(data.properties.action_link);
  } catch (err) {
    console.error('mailru-auth error:', err);
    const back = new URL((SITE_URL || '') + '/login.html');
    back.searchParams.set('error', 'mailru');
    return redirect(back.toString());
  }
});
