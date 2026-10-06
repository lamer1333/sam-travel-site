-- ============================================================================
-- SAM TRAVEL — optional two-factor sign-in for the panel  (migration 060)
-- ============================================================================
-- Two-factor (a 6-digit code from an authenticator app) is each team member's own
-- choice: the panel offers it, nobody is forced. But once someone has switched it on,
-- the password alone must stop being enough — otherwise the second factor would only
-- be a screen in admin.html, and the REST API would still answer a stolen password.
--
-- So the rule lives here: a session carries the team role only if it satisfies the
-- user's own setting.
--   • no verified factor            → password is enough (as before)
--   • a verified factor exists      → the session must be "aal2" (code entered)
-- Every team permission goes through my_role(), so one function decides it all.
-- A client's own data (cabinet) is not affected: those policies compare ids, not roles.
-- ============================================================================

create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = auth.uid() and f.status::text = 'verified');
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid() and public.mfa_ok();
$$;

-- is_staff() came from 001 and read profiles on its own; route it through my_role() too
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('manager', 'admin'), false);
$$;

revoke all on function public.mfa_ok() from anon;
