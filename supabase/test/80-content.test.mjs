// Этап 8 (080_content.sql): роль «Контент», второе фото тура, тип тура, история версий и
// «Вернуть эту версию». Запуск: npm test  (или node supabase/test/run.mjs 80)
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const check = (cond, msg) => (cond ? ok(msg) : bad(msg));
const n = async (who, sql, params) => (await as(who, sql, params)).rows[0].n;
const MEDIA = 'https://x.supabase.co/storage/v1/object/public/media/';

// ---------- роль назначает владелец, и только он ----------
const smm = (await db.query(`insert into auth.users(email, raw_user_meta_data) values ('smm@t.am', '{"full_name":"Сона SMM"}') returning id`)).rows[0].id;
U.smm = smm;
await expectErr('mkt', `select set_role($1, 'content')`, [smm], 'маркетолог не назначает роль «Контент»');
await expectErr('smm', `select set_role($1, 'content')`, [smm], 'человек не назначает роль себе');
await as('owner', `select set_role($1, 'content')`, [smm]);
check((await db.query(`select role::text r from profiles where id = $1`, [smm])).rows[0].r === 'content', 'владелец назначил роль «Контент» через set_role');
check((await as('smm', `select whoami() w`)).rows[0].w.role === 'content', 'whoami отдаёт роль content');
await expectErr('owner', `select set_role($1, 'boss')`, [smm], 'неизвестная роль отклонена');
await expectErr('smm', `update profiles set role = 'admin' where id = $1`, [smm], 'роль «Контент» не повышает себя прямым запросом');
await expectErr('smm', `select set_role($1, 'admin')`, [U.cli], 'роль «Контент» не раздаёт роли');

// ---------- чего роль «Контент» не видит ----------
// данные для проверки создаёт суперпользователь: продажа, кампания, промокод, баннер, событие
await db.exec(`
  insert into leads(name, phone, source, status, value, closed_at) values ('Клиент', '+374 91 000111', 'phone', 'won', 1000, now());
  insert into campaigns(name, channel, utm_source, utm_medium, utm_campaign) values ('К', 'instagram', 'instagram', 'cpc', 'c80');
  insert into coupons(code, discount_pct) values ('SMM80', 5);
  insert into promos(name, kind) values ('Баннер', 'bar');
  insert into events(sid, name) values ('abcdef123456', 'page_view');
  insert into wa_templates(title, lang, body) values ('Ш', 'ru', 'текст');
`);
for (const t of ['leads', 'lead_activity', 'campaigns', 'coupons', 'promos', 'events', 'events_daily', 'site_settings', 'audit_log', 'wa_templates', 'notify_log', 'bookings']) {
  let rows = -1;
  try { rows = await n('smm', `select count(*)::int n from ${t}`); } catch (e) { rows = 0; }
  check(rows === 0, `роль «Контент» не читает ${t}`);
}
check(await n('smm', `select count(*)::int n from profiles`) === 1, 'из profiles видит только свою строку');
for (const [sql, label] of [
  [`select stats_sales(now() - interval '30 days', now())`, 'stats_sales'],
  [`select stats_traffic(now() - interval '30 days', now())`, 'stats_traffic'],
  [`select stats_coupons()`, 'stats_coupons'],
  [`select * from users_list()`, 'users_list'],
  [`select * from audience_list()`, 'audience_list'],
  [`select * from birthdays(1)`, 'birthdays'],
  [`select wa_ref('K7M2X')`, 'wa_ref'],
]) await expectErr('smm', sql, [], `роль «Контент»: ${label} закрыта`);
await expectErr('smm', `insert into leads(name, phone, source, status, value) values ('X', '+374 91 000222', 'phone', 'won', 10)`, [], 'не вносит продажу');
check((await as('smm', `update site_settings set value = '{}' where key = 'contacts'`)).affectedRows === 0, 'не меняет контакты');
check((await as('smm', `update site_settings set value = '{}' where key = 'stats'`)).affectedRows === 0, 'не меняет цифры «о нас»');
await expectErr('smm', `insert into promos(name, kind) values ('Y', 'bar')`, [], 'не создаёт баннер');
await expectErr('smm', `insert into coupons(code, discount_pct) values ('SMM81', 5)`, [], 'не создаёт промокод');
await expectErr('smm', `insert into campaigns(name, channel, utm_source, utm_medium, utm_campaign) values ('Z', 'instagram', 'instagram', 'cpc', 'c81')`, [], 'не создаёт кампанию');

// ---------- что роль «Контент» делает ----------
check(await n('smm', `select count(*)::int n from tours`) === 8, 'видит все туры, включая черновики');
const tour = (await as('smm', `insert into tours(slug, published, tags, photo_url, photo_hero_url, i18n)
  values ('kyoto', true, '{city,nature}', $1, $2, '{"en":{"card_title":"Kyoto"},"ru":{"card_title":"Киото"}}') returning id, updated_by`,
  [MEDIA + 'content/card-1.webp', MEDIA + 'content/hero-1.webp'])).rows[0];
check(tour.updated_by === smm, 'создаёт тур (updated_by — она)');
const pub = (await as('anon', `select public_site() s`)).rows[0].s.tours.find((t) => t.slug === 'kyoto');
check(pub && pub.photo_hero_url === MEDIA + 'content/hero-1.webp' && pub.photo_url === MEDIA + 'content/card-1.webp', 'public_site отдаёт оба кадра: photo_url и photo_hero_url');
check(JSON.stringify(pub.tags) === '["city","nature"]', 'public_site отдаёт тип тура');
check((await as('anon', `select public_site() s`)).rows[0].s.tours.find((t) => t.slug === 'sharm').photo_hero_url === null, 'у тура без кадра шапки photo_hero_url пуст — сайт возьмёт photo_url');
await expectErr('smm', `update tours set tags = '{beach,luxury}' where id = $1`, [tour.id], 'тип тура не из списка отклонён');
await expectErr('mkt', `insert into tours(slug, tags) values ('free-tags', '{любой}')`, [], 'тип тура не из списка отклонён и у маркетолога');
await as('smm', `update tours set tags = '{beach,city,nature,family}' where id = $1`, [tour.id]);
ok('тип тура: можно несколько из списка');

const rev = (await as('smm', `insert into reviews(author, body, published) values ('Ани', '{"ru":"Отлично"}', true) returning id`)).rows[0].id;
const reel = (await as('smm', `insert into reels(url) values ('https://www.instagram.com/reel/Cabc123_-x/') returning id`)).rows[0].id;
await expectErr('smm', `insert into reels(url) values ('https://youtube.com/watch?v=1')`, [], 'рилс: не ссылка Instagram отклонена');
// Этап 10 (100_security.sql, AUDIT D9, решение заказчика 2): в «Команде» роль «Контент» меняет
// только фото — сотрудника заводит владелец. Запреты проверяет 100-security.test.mjs.
const member = (await as('owner', `insert into team(i18n, photo_url, published) values ('{"ru":{"name":"Анна"}}', $1, false) returning id`, [MEDIA + 'content/anna.webp'])).rows[0].id;
check(!!rev && !!reel && !!member, 'создаёт отзыв и рилс; сотрудника заводит владелец');
check((await as('smm', `update team set photo_url = $2 where id = $1`, [member, MEDIA + 'content/anna-2.webp'])).affectedRows === 1, 'меняет фото сотрудника');
check((await as('mkt', `update team set published = true where id = $1`, [member])).affectedRows === 0, 'маркетолог команду по-прежнему не правит');
check((await as('mgr', `update tours set published = false where id = $1`, [tour.id])).affectedRows === 0, 'менеджер туры по-прежнему не правит');
check((await as('smm', `delete from reels where id = $1`, [reel])).affectedRows === 1, 'удаляет рилс');

// ---------- хранилище: загрузка и удаление заменённого фото ----------
// в Supabase таблица storage.objects выдана ролям API, доступ решают политики; в обвязке
// тестов (_db.mjs) выдачи нет — добавляем её здесь, чтобы проверялись именно политики
await db.exec(`grant select, insert, update, delete on storage.objects to anon, authenticated`);
await as('smm', `insert into storage.objects(bucket_id, name) values ('media', 'content/card-1.webp'), ('media', 'content/hero-1.webp'), ('media', 'content/card-2.webp')`);
ok('загружает файлы в бакет media');
await expectErr('smm', `insert into storage.objects(bucket_id, name) values ('private', 'x.webp')`, [], 'в чужой бакет не пишет');
await expectErr('cli', `insert into storage.objects(bucket_id, name) values ('media', 'content/hack.webp')`, [], 'клиент в бакет не пишет');
check((await as('cli', `delete from storage.objects where bucket_id = 'media'`)).affectedRows === 0, 'клиент файлы не удаляет');

await as('owner', `insert into storage.objects(bucket_id, name) values ('media', 'content/tmp-owner.webp')`);
check((await as('owner', `delete from storage.objects where bucket_id = 'media' and name = 'content/tmp-owner.webp'`)).affectedRows === 1, 'владелец удаляет файл из бакета (политика чтения бакета)');
check(await n('mgr', `select count(*)::int n from storage.objects where bucket_id = 'media'`) === 3 && (await as('mgr', `delete from storage.objects where bucket_id = 'media'`)).affectedRows === 0, 'менеджер файлы видит, но не удаляет — как раньше');

// ---------- история версий ----------
// версия 1 — создание; версия 2 — новый текст; версия 3 — фото карточки заменено, старое удалено из бакета
await as('smm', `update tours set i18n = '{"en":{"card_title":"Kyoto in autumn"},"ru":{"card_title":"Киото осенью"}}', price_from = 1900 where id = $1`, [tour.id]);
await as('mkt', `update tours set photo_url = $2, i18n = '{"en":{"card_title":"Kyoto, broken"}}', price_from = null, sort = 7 where id = $1`, [tour.id, MEDIA + 'content/card-2.webp']);
check((await as('smm', `delete from storage.objects where bucket_id = 'media' and name = 'content/card-1.webp'`)).affectedRows === 1, 'удаляет из бакета заменённое фото');

const hist = (await as('smm', `select * from row_history('tours', $1)`, [tour.id])).rows;
check(hist.length === 4 && hist[hist.length - 1].action === 'insert', `история тура: ${hist.length} версии, от новой к старой`);
check(hist[0].actor === U.mkt && hist[0].actor_name === 'mkt' && hist[1].actor_name === 'Сона SMM', 'у версии есть дата и автор');
check(hist[1].version.i18n.ru.card_title === 'Киото осенью' || hist[2].version.i18n.ru.card_title === 'Киото осенью', 'версия хранит запись целиком');
await expectErr('mgr', `select * from row_history('tours', $1)`, [tour.id], 'менеджер историю тура не читает');
await expectErr('cli', `select * from row_history('tours', $1)`, [tour.id], 'клиент историю не читает');
await expectErr('anon', `select * from row_history('tours', $1)`, [tour.id], 'гость историю не читает');
await expectErr('mkt', `select * from row_history('team', $1)`, [member], 'маркетолог историю команды не читает (таблица не его)');
await expectErr('owner', `select * from row_history('leads', $1)`, [tour.id], 'история — только для контента сайта');
await expectErr('smm', `select * from row_history('site_settings', $1)`, [tour.id], 'роль «Контент» видит историю только своих разделов');
check((await as('smm', `select * from row_history('team', $1)`, [member])).rows.length === 2, 'история сотрудника видна роли «Контент»');
check((await as('owner', `select * from row_history('reviews', $1)`, [rev])).rows.length === 1, 'история отзыва видна владельцу');

// ---------- «Вернуть эту версию» ----------
const good = hist.find((h) => h.version.price_from !== null && Number(h.version.price_from) === 1900);
const logBefore = (await db.query(`select count(*)::int n from audit_log where table_name = 'tours' and row_id = $1`, [tour.id])).rows[0].n;
const back = (await as('smm', `select restore_version($1) r`, [good.id])).rows[0].r;
const now1 = (await db.query(`select * from tours where id = $1`, [tour.id])).rows[0];
check(now1.i18n.ru.card_title === 'Киото осенью' && Number(now1.price_from) === 1900, 'возврат версии: текст и цена — как в ней');
check(back.row.id === tour.id && back.row.i18n.ru.card_title === 'Киото осенью', 'restore_version отдаёт запись, как она стала');
check(now1.sort === 7 && now1.published === true, 'порядок и «Опубликован» возврат не трогает');
check(back.photo_kept === true && now1.photo_url === MEDIA + 'content/card-2.webp', 'фото той версии уже удалено из хранилища — осталось нынешнее, ответ об этом говорит');
check(now1.photo_hero_url === MEDIA + 'content/hero-1.webp', 'фото, которое в хранилище есть, остаётся на месте');
const log = (await db.query(`select actor, action, before, after from audit_log where table_name = 'tours' and row_id = $1 order by id desc`, [tour.id])).rows;
check(log.length === logBefore + 1 && log[0].actor === smm && log[0].action === 'update', 'возврат записан в журнал как правка, под именем вернувшего');
check(log[0].before.i18n.en.card_title === 'Kyoto, broken' && log[0].after.i18n.en.card_title === 'Kyoto in autumn', 'в журнале — «было» и «стало» возврата');
check(now1.updated_by === smm, 'updated_by — тот, кто вернул');

// версия, фото которой на месте, возвращается вместе с фото
await as('smm', `insert into storage.objects(bucket_id, name) values ('media', 'content/card-1.webp')`);
const back2 = (await as('owner', `select restore_version($1) r`, [good.id])).rows[0].r;
check(back2.photo_kept === false && back2.row.photo_url === MEDIA + 'content/card-1.webp', 'фото версии на месте — возвращается вместе с ней');

// права на возврат — те же, что на таблицу
await expectErr('mgr', `select restore_version($1)`, [good.id], 'менеджер версию тура не возвращает');
await expectErr('cli', `select restore_version($1)`, [good.id], 'клиент версию не возвращает');
await expectErr('anon', `select restore_version($1)`, [good.id], 'гость версию не возвращает');
const teamV = (await as('smm', `select * from row_history('team', $1)`, [member])).rows.pop();
await expectErr('mkt', `select restore_version($1)`, [teamV.id], 'маркетолог версию сотрудника не возвращает');
check((await as('smm', `select restore_version($1) r`, [teamV.id])).rows[0].r.row.id === member, 'роль «Контент» возвращает версию сотрудника');
check((await db.query(`select published from team where id = $1`, [member])).rows[0].published === false, '…и сотрудник остался скрытым, как был');
await expectErr('smm', `select restore_version(-1)`, [], 'несуществующая версия');
const foreign = (await db.query(`select id from audit_log where table_name not in ('tours','reviews','reels','team') order by id limit 1`)).rows[0];
if (foreign) await expectErr('owner', `select restore_version($1)`, [foreign.id], 'строки журнала о других таблицах не возвращаются');
else { await as('owner', `update site_settings set value = value where key = 'hours'`); const f2 = (await db.query(`select id from audit_log where table_name = 'site_settings' limit 1`)).rows[0]; await expectErr('owner', `select restore_version($1)`, [f2.id], 'строки журнала о других таблицах не возвращаются'); }

// удалённую запись возвращает только владелец
await as('smm', `delete from reviews where id = $1`, [rev]);
const delLine = (await db.query(`select id from audit_log where table_name = 'reviews' and row_id = $1 and action = 'delete'`, [rev])).rows[0];
check(!!delLine, 'удаление отзыва осталось в журнале');
await expectErr('smm', `select restore_version($1)`, [delLine.id], 'роль «Контент» удалённую запись не возвращает');
const revBack = (await as('owner', `select restore_version($1) r`, [delLine.id])).rows[0].r;
const revRow = (await db.query(`select author, body, published from reviews where id = $1`, [rev])).rows[0];
check(revBack.row.id === rev && revRow && revRow.author === 'Ани' && revRow.body.ru === 'Отлично' && revRow.published === true, 'владелец возвращает удалённую запись целиком, с тем же id');
check((await db.query(`select action from audit_log where table_name = 'reviews' and row_id = $1 order by id desc limit 1`, [rev])).rows[0].action === 'insert', 'возврат удалённой записи тоже в журнале');

// журнал целиком по-прежнему только у владельца
check(await n('smm', `select count(*)::int n from audit_log`) === 0, 'журнал изменений роль «Контент» не читает и после всего');
check(await n('owner', `select count(*)::int n from audit_log`) > 0, 'владелец журнал читает');

// ---------- прежние роли ничего не потеряли ----------
check(await n('mkt', `select count(*)::int n from tours`) === 9 && await n('mgr', `select count(*)::int n from tours`) === 9, 'маркетолог и менеджер читают туры, как раньше');
check(await n('cli', `select count(*)::int n from tours`) === 0 && await n('anon', `select count(*)::int n from tours`) === 0, 'клиент и гость таблицу туров не читают');
await as('owner', `select set_role($1, 'client')`, [smm]);
check(await n('smm', `select count(*)::int n from tours`) === 0, 'роль сняли — доступа к турам нет');
check((await as('smm', `update tours set published = false`)).affectedRows === 0, '…и к правке тоже');
