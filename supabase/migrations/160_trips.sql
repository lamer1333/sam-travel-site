-- ============================================================================
-- SAM TRAVEL — этап 16: поездки клиентов в панели
-- ============================================================================
-- Накатывается после 150_travel.sql.
--
-- Этап 15 положил в аккаунт клиента его поездку и список документов и оставил их
-- видимыми только самому клиенту. Теперь их видят владелец и менеджер: панель →
-- «Клиенты и команда» → «Поездки». Менеджер пишет человеку уже зная, куда и когда
-- он собирается и каких документов не хватает.
--
-- Что добавляет:
--   • client_trips() — клиенты, у которых в кабинете что-то выбрано: имя, email,
--     телефон, язык, план поездки и список документов как есть
--
-- Кого видно: только клиентов и только тех, кто сам сохранил поездку или список.
-- Остальной список клиентов сайта менеджеру по-прежнему закрыт (users_list отдаёт
-- ему одну команду), дату рождения он не получает. Маркетолог и «Контент» эту
-- функцию не вызывают. Менять чужую поездку не может никто: save_travel() пишет
-- только свою строку.
-- ============================================================================

create or replace function public.client_trips()
returns table (id uuid, email text, full_name text, phone text, lang text,
               plan jsonb, checklist jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.my_role() in ('admin', 'manager'), false) is not true then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.lang, t.plan, t.checklist, t.updated_at
    from public.client_travel t
    join public.profiles p on p.id = t.user_id
    join auth.users u on u.id = p.id
    where p.role::text = 'client'
      and (coalesce(t.plan ->> 'dest', '') <> '' or coalesce(t.plan ->> 'from', '') <> ''
           or coalesce(t.checklist ->> 'dest', '') <> '')
    order by t.updated_at desc
    limit 500;
end; $$;

revoke all on function public.client_trips() from public, anon;
grant execute on function public.client_trips() to authenticated;
