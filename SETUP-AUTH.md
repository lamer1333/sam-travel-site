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
| `index.html` `#auth` | Sign in / register form, in-page (email/password + Google). Opened from the burger menu "Sign in". Logic lives in `js/app.js`; strings in `js/pages.js` (`AUI`, all three languages). |
| `cabinet.html` | Client cabinet — the profile only: date of birth and the mailing consent (a switch). First-login screen for Google users. The page the «Forgot password» link opens: the new password (at least 10 characters) is set here. The site has no request form and no bookings (TZ-BACKEND.md §0 п.20–22). |
| `js/supabase-config.js` | **Your public keys go here.** |
| `js/auth.js` | Cabinet logic (the login form is in `js/app.js`). |

The in-page form redirects to `cabinet.html` on success; the cabinet sends
signed-out visitors back to `index.html#auth`.

---

## Status (2026-10-09)

- ✅ Supabase project **SamTravel** created on the client's account (2026-10-09) — ref `zorcltqxulshhxgbvsim`, region Frankfurt. The old Sydney project `kxbxbjkcvoeuyqyztqmw` is not used.
- ✅ Publishable key + URL inserted into `js/supabase-config.js`.
- ✅ Migrations `supabase/migrations/*.sql` (001–110) applied with `supabase db push` on 2026-10-10.
- ✅ Auth → URL Configuration: Site URL `https://samtravel.am`; redirect URLs for localhost preview + samtravel.am.
- ✅ Google Cloud project `samtravel-site` (client's account): consent screen + OAuth client «SAM TRAVEL site».
- ✅ Google: redirect URI `https://zorcltqxulshhxgbvsim.supabase.co/auth/v1/callback`, keys pasted into Supabase; sign-in verified locally on 2026-10-10 (Google → cabinet).
- ⬜ Google: app published (Audience → Publish app) — until then only test users can sign in.
- ✅ Email sign-up verified locally on 2026-10-10: custom SMTP is Mailjet (`in-v3.mailjet.com:587`, sender `samtravel.code@proton.me`), template «Confirm sign up» = `supabase/templates/confirm-signup.html`, Email OTP length 6, expiration 3600 s, minimum password length 10.
- ✅ First owner promoted in the SQL Editor on 2026-10-10; `admin.html` opens. Further roles — in the panel, «Клиенты и команда».
- ⬜ Before launch: send from an address on the site's own domain (verify the domain in the mail service) — mail «from proton.me» sent through a third-party service often lands in spam.

Still to do: publish the Google app, deploy `lead-mail`, move the mail sender to the site's domain (see bottom).

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
Authentication → **URL Configuration** → set **Site URL** to `https://samtravel-dny.pages.dev`
and add `https://samtravel-dny.pages.dev/**` to **Redirect URLs**
(plus `http://localhost:8931/...` while testing locally).

## 4. Google login

1. <https://console.cloud.google.com> → create a project → **APIs & Services →
   Credentials** → **Create OAuth client ID** → *Web application*.
2. Under **Authorized redirect URIs** add the callback Supabase shows you:
   `https://abcd1234.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret**.
4. Supabase → Authentication → Providers → **Google** → paste both → save.

That's it — the "Continue with Google" button works.

## 5. Mail.ru login — removed

Sign-in with Mail.ru was taken out on 2026-10-10: registering the Mail.ru app needs a
mail.ru mailbox, and the project has none. The button, the client code and the edge function
`mailru-auth` are gone (the last version is in git history before that date). Sign-in is
email/password or Google. Migration `100_security.sql` still creates `auth_user_by_email()`;
it is unused and closed to every API role.

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
  Google users get the consent screen on first login.
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

- **Custom SMTP.** Connected (Mailjet). Supabase does not let you edit email templates or
  send to real clients without it. What is left is the sender: move it from
  `samtravel.code@proton.me` to an address on the site's domain once the domain works.
- **Domain.** `samtravel.am` did not resolve on 2026-10-10, so since 2026-10-11 the live
  site is `https://samtravel-dny.pages.dev`. The mail sender still needs a domain of its own.
- **Promote your admin** (step 6) after you sign up with your real email.

## Test checklist

- [ ] Register with email → confirm → land in cabinet
- [ ] Sign out → sign in again
- [ ] Forgot password → the link from the email opens the cabinet with the «New password» form → a password shorter than 10 characters is refused → sign in with the new one
- [ ] Google login → first-login consent screen shows → cabinet
- [ ] The mailing switch in the cabinet turns the consent off and on; the client leaves / returns to «Подписчики»
- [ ] A client cannot read another client's profile (RLS)
- [ ] `marketing_audience` lists only consented users
