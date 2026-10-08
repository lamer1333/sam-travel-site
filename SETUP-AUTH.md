# SAM TRAVEL — auth setup

Login + client cabinet on **Supabase**. The site stays static; it talks to
Supabase from the browser. Passwords are never stored by us — Supabase Auth
handles hashing, email confirmation and password reset.

**What I built** · **what you do** (create accounts, paste keys, send mailings).

---

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/001_schema.sql` | Tables, roles, consent fields, coupons, Row Level Security. Run first, then the other migrations in order. |
| `index.html` `#auth` | Sign in / register form, in-page (email/password + Google + Mail.ru). Opened from the burger menu "Sign in". Logic lives in `js/app.js`; strings in `js/pages.js` (`AUI`, all three languages). |
| `cabinet.html` | Client cabinet — the profile only: date of birth and the mailing consent (a switch). First-login screen for Google / Mail.ru users. The page the «Forgot password» link opens: the new password (at least 10 characters) is set here. The site has no request form and no bookings (TZ-BACKEND.md §0 п.20–22). |
| `js/supabase-config.js` | **Your public keys go here.** |
| `js/auth.js` | Cabinet logic (the login form is in `js/app.js`). |
| `supabase/functions/mailru-auth/index.ts` | Mail.ru login bridge (edge function). |

The in-page form redirects to `cabinet.html` on success; the cabinet sends
signed-out visitors back to `index.html#auth`.

---

## Status (done on 2026-09-22)

- ✅ Supabase project **SamTravel** created — ref `kxbxbjkcvoeuyqyztqmw`, region Sydney.
- ✅ Publishable key + URL inserted into `js/supabase-config.js`.
- ✅ `001_schema.sql` (then named `schema.sql`) run in the SQL Editor (tables, RLS, triggers, view).
- ✅ Auth → URL Configuration: Site URL `https://samtravel.am`; redirect URLs for localhost preview + samtravel.am.
- ✅ Verified end-to-end with a test user (`demo@samtravel.am`) — login, auto-profile, RLS, cabinet all work.

Still to do (need your external accounts): **Google** (step 4), **Mail.ru** (step 5),
promote your admin (step 6), plus **custom SMTP** and **deleting the demo user** (see bottom).

---

## 1. Create the Supabase project  — done

1. Sign up at <https://supabase.com> → **New project**. Pick a region close to
   your users (EU works well for Armenia). Save the database password it gives you.
2. Project Settings → **API**. Copy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key
3. Paste both into `js/supabase-config.js`:
   ```js
   window.SAM_SUPABASE = {
     url: 'https://abcd1234.supabase.co',
     anonKey: 'eyJhbGc...your-anon-key...',
   };
   ```
   > The anon key is **safe** in the browser — RLS restricts it. Never paste the
   > `service_role` key here.

## 2. Create the tables

Supabase → **SQL Editor** → paste all of `supabase/migrations/001_schema.sql` → **Run**.
It creates the tables, the auto-profile trigger, and all RLS policies.

## 3. Turn on email/password

Authentication → **Providers** → **Email**: keep enabled. For launch you may
turn **"Confirm email"** on (recommended) or off (faster testing).
Authentication → **URL Configuration** → set **Site URL** to `https://samtravel.am`
and add `https://samtravel.am/cabinet.html` to **Redirect URLs**
(plus `http://localhost:8931/...` while testing locally).

## 4. Google login

1. <https://console.cloud.google.com> → create a project → **APIs & Services →
   Credentials** → **Create OAuth client ID** → *Web application*.
2. Under **Authorized redirect URIs** add the callback Supabase shows you:
   `https://abcd1234.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret**.
4. Supabase → Authentication → Providers → **Google** → paste both → save.

That's it — the "Continue with Google" button works.

## 5. Mail.ru login (the bridge)

Mail.ru isn't a built-in provider, so we deploy a small function.

1. Register an app at <https://oauth.mail.ru/app/> (Mail.ru for Developers).
   Set the **redirect URI** to:
   `https://abcd1234.functions.supabase.co/mailru-auth`
   Copy the **client_id** and **client_secret**.
2. Install the CLI and deploy:
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref abcd1234
   supabase functions deploy mailru-auth --no-verify-jwt
   ```
3. Set the function secrets (these stay server-side — never in the browser):
   ```bash
   supabase secrets set \
     MAILRU_CLIENT_ID=xxx \
     MAILRU_CLIENT_SECRET=xxx \
     MAILRU_REDIRECT_URI=https://abcd1234.functions.supabase.co/mailru-auth \
     SB_URL=https://abcd1234.supabase.co \
     SB_SERVICE_ROLE_KEY=<service_role key from Settings → API> \
     SITE_URL=https://samtravel.am
   ```

The "Continue with Mail.ru" button now works.

## 6. Make yourself admin

Sign up once (email or Google), then in SQL Editor find your id and promote:
```sql
select id, email from auth.users;
update public.profiles set role = 'admin' where id = '<your-uuid>';
```
Roles: `client` (default), `manager` (sales journal), `marketer`, `content` (SMM), `admin` (owner). After the first owner exists, roles are assigned in the panel — «Клиенты и команда» (see `SETUP-ADMIN.md`); a direct `update` of `role` from the API is refused.

## 7. Entry point — already wired

The burger menu "Sign in" (translated: Войти / Մուտք) opens the in-page `#auth`
form. Once a visitor is signed in, that entry sends them to `cabinet.html`
instead. Nothing to do here.

---

## Marketing mailings (discounts & coupons)

The legal + deliverability part — **you** connect the mail service and send;
the data plumbing is already here:

- **Consent is stored, not assumed.** `profiles.marketing_consent` +
  `consent_at` + `consent_source`. The register form has an opt-in checkbox;
  Google/Mail.ru users get the consent screen on first login.
- **Your audience** = the `marketing_audience` view — only people who consented,
  with their email and language (en/ru/hy) so you can send in the right one.
- **Send with a real ESP**, not your own server: **Brevo** or **Resend** (free
  tiers, good deliverability). Export the segment or connect via their API.
- **Unsubscribe link is mandatory** in every mailing — the ESP adds it, and you
  should flip `marketing_consent = false` when someone opts out.
- **Unsubscribing from the cabinet.** A client switches the mailing off (or back on)
  in `cabinet.html`; the `set_consent()` RPC keeps `consent_at` / `consent_source`.
- **Coupons** live in `coupons` (panel → «Промокоды»). A code travels in the client's
  WhatsApp message; the owner types it in when entering the sale. The old
  `bookings` / `coupon_redemptions` tables are frozen and not used.

> I don't send the mailings for you — connecting the ESP and sending real email
> is done from your accounts with your consent. I built everything up to that line.

---

## Before launch

- **Custom SMTP.** Supabase's built-in email is rate-limited (~2–3/hour) and for
  testing only, so email confirmation + password-reset links won't reliably reach
  real clients. Connect an SMTP provider (Brevo / Resend — the same ESP you'll use
  for mailings) in Authentication → Emails → SMTP before going live.
- **Region.** The existing project is in Sydney. The launch is a new project in
  Frankfurt with a clean database (stage 6, TZ-BACKEND.md §8.1) — nothing is moved over.
- **Promote your admin** (step 6) after you sign up with your real email.

## Test checklist

- [ ] Register with email → confirm → land in cabinet
- [ ] Sign out → sign in again
- [ ] Forgot password → the link from the email opens the cabinet with the «New password» form → a password shorter than 10 characters is refused → sign in with the new one
- [ ] Google login → first-login consent screen shows → cabinet
- [ ] Mail.ru login → cabinet
- [ ] The mailing switch in the cabinet turns the consent off and on; the client leaves / returns to «Подписчики»
- [ ] A client cannot read another client's profile (RLS)
- [ ] `marketing_audience` lists only consented users
