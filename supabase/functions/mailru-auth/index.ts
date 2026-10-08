// ============================================================================
// Mail.ru → Supabase auth bridge  (Supabase Edge Function, Deno)
// ----------------------------------------------------------------------------
// Mail.ru is NOT a built-in Supabase OAuth provider, so we bridge it ourselves.
// The logic lives in handler.mjs (it is tested on fake Mail.ru and Supabase answers in
// supabase/test/100-security.test.mjs); this file only hands it the environment and a
// Supabase client with the service_role key.
//
//   1. /mailru-auth/start  → a random number goes into a cookie and into `state`,
//                            the user goes to Mail.ru's consent screen
//   2. Mail.ru redirects back here with ?code=…&state=… → `state` must match the cookie
//   3. the code is swapped for the user's email
//   4. the user is found or created in Supabase (service_role, server-side only); an
//      account with an unconfirmed address gets its password reset first
//   5. a magic link is minted and the browser is bounced through it → logged in
//
// Secrets to set (Supabase → Edge Functions → Secrets), NEVER in the browser. Without
// any of them the function answers 500 «not configured» and does nothing:
//   MAILRU_CLIENT_ID
//   MAILRU_CLIENT_SECRET
//   MAILRU_REDIRECT_URI      = https://<project>.supabase.co/functions/v1/mailru-auth
//                              ← the SAME host the site opens (js/app.js): the state
//                              cookie is read only by the host that set it
//   SB_URL                   = https://<project>.supabase.co
//   SB_SERVICE_ROLE_KEY      = <service_role key>   ← bypasses RLS; keep secret
//   SITE_URL                 = https://samtravel.am
// «Verify JWT» у функции выключить: её открывает браузер без входа.
// Needs migration 100_security.sql (auth_user_by_email).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';   // the exact version, the same as js/vendor/
import { handle } from './handler.mjs';

const env = Deno.env.toObject();
let admin: unknown = null;
try {
  if (env.SB_URL && env.SB_SERVICE_ROLE_KEY) admin = createClient(env.SB_URL, env.SB_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
} catch (_) { admin = null; }   // a bad SB_URL must not take the function down: handler.mjs answers «not configured»

Deno.serve((req) => handle(req, env, { admin }));
