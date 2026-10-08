-- ============================================================================
-- SAM TRAVEL — stage 8: the panel for the SMM specialist (TZ-CONTENT.md §7–§9)
-- Run after 070_whatsapp.sql.
-- Only as part of the whole set, in order: after re-running this file alone, re-run every
-- later migration too — on its own it brings back what the later files closed (AUDIT.md, D6).
--
--   • role `content`   — sees and edits one thing: tours, reviews, reels and the team
--                        photos, plus the files of the `media` bucket. No sales, clients,
--                        traffic, campaigns, promo codes, banners, subscribers, contacts
--                        or audit log: none of the older checks (is_team, is_staff,
--                        is_marketing, is_owner) lets this role in, and they stay as they are
--   • tours.photo_hero_url — the 16 : 9 frame for the head of the tour description;
--                        public_site() gives it to the site
--   • tours.tags       — the tour type: only beach / city / nature / family
--   • row_history()    — past versions of one content row, from audit_log
--   • restore_version()— «Вернуть эту версию»: an ordinary update, so it lands in the log
--
-- Error codes for the panel (see errText in js/admin/api.js):
--   version_not_found, not_content_table, forbidden
-- ============================================================================

-- ---------- role: content ---------------------------------------------------
-- A new enum value cannot be USED in the same transaction that adds it, so every
-- check compares role::text (as 002_admin.sql does for `marketer`).
alter type public.user_role add value if not exists 'content';

create or replace function public.is_content()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'content', false);
$$;

-- Who may write a content table. Before this stage: tours, reviews and reels — owner and
-- marketer; team — owner only. The content role is added to all four, nobody loses anything.
create or replace function public.can_edit_content(p_table text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_table in ('tours', 'reviews', 'reels') then public.is_marketing() or public.is_content()
    when p_table = 'team' then public.is_owner() or public.is_content()
    else false end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tours', 'reviews', 'reels', 'team'] loop
    execute format('drop policy if exists "%s: content read" on public.%I', t, t);
    execute format('drop policy if exists "%s: content write" on public.%I', t, t);
    execute format('create policy "%s: content read" on public.%I for select using (public.is_content())', t, t);
    execute format('create policy "%s: content write" on public.%I for all using (public.is_content()) with check (public.is_content())', t, t);
  end loop;
end $$;

-- the photos: upload, and delete the ones a newer photo replaced
drop policy if exists "media: content insert" on storage.objects;
drop policy if exists "media: content update" on storage.objects;
drop policy if exists "media: content delete" on storage.objects;
create policy "media: content insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_content());
create policy "media: content update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_content());
create policy "media: content delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_content());
-- Deleting a file needs to SEE it first: Postgres applies the select policies to the rows a
-- delete looks for, and Supabase Storage does the same. 002 gave the team no select policy
-- on the bucket, so its delete policy matched nothing. The bucket is public anyway.
drop policy if exists "media: editors read" on storage.objects;
create policy "media: editors read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (public.is_team() or public.is_content()));

-- the owner hands the role out like the others
create or replace function public.set_role(p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_change_own_role'; end if;
  if p_role not in ('client', 'manager', 'marketer', 'content', 'admin') then raise exception 'bad_role'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user;
end; $$;
revoke all on function public.set_role(uuid, text) from anon;

-- ---------- tours: the second frame and the type ----------------------------
alter table public.tours add column if not exists photo_hero_url text;
comment on column public.tours.photo_url is 'карточка в карусели, 2 : 3 (1080 × 1620)';
comment on column public.tours.photo_hero_url is 'шапка описания тура, 16 : 9 (1600 × 900); пусто — сайт берёт photo_url';

-- The type is picked from a list, not typed in. NOT VALID: rows written before this stage
-- are left alone, every new and edited row is checked.
alter table public.tours drop constraint if exists tours_tags_known;
alter table public.tours add constraint tours_tags_known
  check (tags <@ array['beach', 'city', 'nature', 'family']::text[]) not valid;

-- ---------- what the site reads ---------------------------------------------
-- The same as in 002_admin.sql plus tours.photo_hero_url.
create or replace function public.public_site()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- company: only what the page prints (licence, insurance, name) — never the margin
    'settings', coalesce((select jsonb_object_agg(key, case when key = 'company' then value - 'margin_pct' - 'currency' else value end)
                          from public.site_settings
                          where key in ('contacts', 'company', 'stats', 'hours', 'seo', 'analytics')), '{}'::jsonb),
    'tours',   coalesce((select jsonb_agg(jsonb_build_object(
                  'slug', slug, 'photo_url', photo_url, 'photo_hero_url', photo_hero_url, 'photo_class', photo_class, 'tags', tags,
                  'price_from', price_from, 'currency', currency, 'i18n', i18n) order by sort)
                from public.tours where published and (hot_until is null or hot_until >= (now() at time zone 'Asia/Yerevan')::date)), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
                  'author', author, 'trip', trip, 'rating', rating, 'body', body, 'photo_url', photo_url, 'source', source)
                  order by featured desc, sort, created_at desc)
                from public.reviews where published), '[]'::jsonb),
    'team',    coalesce((select jsonb_agg(jsonb_build_object('i18n', i18n, 'photo_url', photo_url) order by sort)
                from public.team where published), '[]'::jsonb),
    'reels',   coalesce((select jsonb_agg(url order by sort) from public.reels where published), '[]'::jsonb),
    'promos',  coalesce((select jsonb_agg(jsonb_build_object(
                  'id', id, 'kind', kind, 'i18n', i18n, 'link', link, 'coupon_code', coupon_code,
                  'theme', theme, 'audience', audience) order by created_at desc)
                from public.promos
                where active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())), '[]'::jsonb)
  );
$$;
grant execute on function public.public_site() to anon, authenticated;

-- ============================================================================
-- history of a record and «Вернуть эту версию»
-- ============================================================================
create index if not exists audit_row_idx on public.audit_log (table_name, row_id, at desc);

-- Past versions of one row, newest first. The audit log itself stays owner-only; this
-- gives a person the history of the tables they may edit and nothing else.
-- A version = the row as it was saved (audit_log.after).
create or replace function public.row_history(p_table text, p_id uuid)
returns table (id bigint, at timestamptz, action text, actor uuid, actor_name text, version jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_table not in ('tours', 'reviews', 'reels', 'team') then raise exception 'not_content_table'; end if;
  if not public.can_edit_content(p_table) then raise exception 'forbidden'; end if;
  return query
    select a.id, a.at, a.action, a.actor, coalesce(nullif(btrim(p.full_name), ''), u.email::text), a.after
    from public.audit_log a
    left join public.profiles p on p.id = a.actor
    left join auth.users u on u.id = a.actor
    where a.table_name = p_table and a.row_id = p_id::text and a.action in ('insert', 'update')
    order by a.at desc, a.id desc
    limit 100;
end; $$;

-- Is the file behind this address still in the bucket? Addresses that are not ours
-- (another host, a built-in picture) are never checked — they are taken as they are.
create or replace function public.media_alive(p_url text)
returns boolean language sql stable security definer set search_path = public, storage as $$
  select case
    when p_url is null or p_url !~ '/storage/v1/object/public/media/' then true
    else exists (select 1 from storage.objects o
                 where o.bucket_id = 'media'
                   and o.name = split_part(regexp_replace(p_url, '^.*/storage/v1/object/public/media/', ''), '?', 1))
  end;
$$;
revoke all on function public.media_alive(text) from anon, authenticated;

-- Put a row back to the version written in one line of the audit log.
--   • the row exists      — whoever may edit the table. Texts, photos, price, type and the
--                           rest come back; the place in the list (`sort`) and «Опубликован»
--                           stay as they are now, so a return never takes a tour off the site
--   • the row was deleted — the owner only (TZ-CONTENT.md §9.4); it comes back whole
--   • a photo of that version is no longer in the bucket (it was replaced, and replaced
--     photos are deleted) — the present photo stays, and the answer says so
-- It is an ordinary write: the audit trigger records it under the caller's name.
create or replace function public.restore_version(p_audit bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  a      public.audit_log;
  snap   jsonb;
  cur    jsonb;
  rid    uuid;
  cols   text;
  k      text;
  kept   boolean := false;
  res    jsonb;
begin
  select * into a from public.audit_log where id = p_audit;
  if not found then raise exception 'version_not_found'; end if;
  if a.table_name not in ('tours', 'reviews', 'reels', 'team') then raise exception 'not_content_table'; end if;
  if not public.can_edit_content(a.table_name) then raise exception 'forbidden'; end if;
  snap := coalesce(a.after, a.before);
  rid := a.row_id::uuid;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', a.table_name) using rid into cur;

  foreach k in array array['photo_url', 'photo_hero_url'] loop
    if snap ? k and not public.media_alive(snap ->> k) then
      snap := jsonb_set(snap, array[k], coalesce(cur -> k, 'null'::jsonb));
      kept := true;
    end if;
  end loop;

  if cur is null then
    if not public.is_owner() then raise exception 'forbidden'; end if;
    execute format('insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1) returning to_jsonb(%1$I.*)', a.table_name)
      using snap into res;
  else
    select string_agg(quote_ident(attname), ', ') into cols
    from pg_attribute
    where attrelid = format('public.%I', a.table_name)::regclass and attnum > 0 and not attisdropped
      and attname not in ('id', 'created_at', 'updated_at', 'updated_by', 'sort', 'published');
    -- to_jsonb(t) || snap: a column added after that version keeps its present value
    execute format('update public.%1$I t set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, to_jsonb(t) || $1)) where t.id = $2 returning to_jsonb(t.*)', a.table_name, cols)
      using snap, rid into res;
  end if;
  return jsonb_build_object('row', res, 'photo_kept', kept);
end; $$;

revoke all on function public.row_history(text, uuid) from anon;
revoke all on function public.restore_version(bigint) from anon;
grant execute on function public.row_history(text, uuid) to authenticated;
grant execute on function public.restore_version(bigint) to authenticated;
grant execute on function public.is_content() to anon, authenticated;
grant execute on function public.can_edit_content(text) to anon, authenticated;
