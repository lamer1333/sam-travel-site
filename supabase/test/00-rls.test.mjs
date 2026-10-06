// Права (RLS) и функции базовой схемы: миграции 001_schema + 002_admin.
// Запуск: npm test  (или node supabase/test/run.mjs 00)
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const ps = (await as('anon', `select public_site() s`)).rows[0].s;
ps.tours.length === 5 ? ok('public_site: 5 published tours') : bad('tours ' + ps.tours.length);
ps.settings.contacts.phone ? ok('public_site: settings present') : bad('settings');
const lid = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Anna', phone: '+374 91 000-111', message: 'Dubai in Nov', utm_source: 'instagram', utm_campaign: 'nov_dubai', sid: 'abc', tour: 'dubai' })])).rows[0].id;
lid ? ok('anon submit_lead') : bad('submit_lead');
const dup = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Anna', phone: '37491000111' })])).rows[0].id;
dup === lid ? ok('duplicate within 3 min de-duplicated') : bad('dedupe');
const hp = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Bot', phone: '12345678', website: 'x' })])).rows[0].id;
hp === null ? ok('honeypot swallowed') : bad('honeypot');
await expectErr('anon', `select submit_lead($1)`, [JSON.stringify({ name: 'X', phone: '12' })], 'bad phone rejected');
await as('anon', `select track($1)`, [JSON.stringify([{ sid: 'abc', name: 'page_view', utm_source: 'instagram', utm_campaign: 'nov_dubai', device: 'mobile', lang: 'ru' }, { sid: 'abc', name: 'wa_click' }, { sid: 'abc', name: 'evil' }])]);
const evn = (await db.query(`select count(*)::int n from events`)).rows[0].n;
evn === 3 ? ok('track: 2 accepted + lead_submit, bogus name dropped') : bad('events ' + evn);
for (const w of ['anon', 'cli', 'mkt']) {
  const n = (await as(w, `select count(*)::int n from leads`)).rows[0].n;
  n === 0 ? ok(w + ' sees 0 leads (RLS)') : bad(w + ' sees ' + n + ' leads');
}
const mn = (await as('mgr', `select count(*)::int n from leads`)).rows[0].n;
mn === 1 ? ok('manager sees the lead') : bad('mgr ' + mn);
await as('mgr', `update leads set status='contacted', assigned_to=$1 where id=$2`, [U.mgr, lid]);
const l = (await db.query(`select first_response_at, status from leads where id=$1`, [lid])).rows[0];
l.first_response_at ? ok('SLA first_response_at set by trigger') : bad('first_response_at');
const acts = (await db.query(`select kind from lead_activity where lead_id=$1 order by created_at`, [lid])).rows.map(r => r.kind).join(',');
acts === 'system,status,assign' ? ok('activity timeline: ' + acts) : bad('activity ' + acts);
await as('mgr', `update leads set status='won', value=2400 where id=$1`, [lid]);
(await db.query(`select closed_at from leads where id=$1`, [lid])).rows[0].closed_at ? ok('closed_at on won') : bad('closed_at');
const st = (await as('mkt', `select stats_traffic(now() - interval '7 days', now() + interval '1 day') s`)).rows[0].s;
console.log('    stats:', JSON.stringify({ funnel: st.funnel, campaigns: st.campaigns, sources: st.sources, days: st.daily.length }));
st.campaigns[0]?.won === 1 && st.funnel.visits === 1 ? ok('marketer stats_traffic: campaign → won attributed') : bad('stats');
await expectErr('cli', `select stats_traffic(now() - interval '7 days', now())`, [], 'client stats_traffic forbidden');
await expectErr('cli', `select * from marketing_audience`, [], 'marketing_audience view locked');
await expectErr('anon', `select * from marketing_audience`, [], 'marketing_audience locked for anon');
const aud = (await as('mkt', `select * from audience_list()`)).rows;
aud.length === 1 && aud[0].email === 'cli@t.am' ? ok('audience_list for marketer: 1 consented') : bad('audience ' + aud.length);
await expectErr('mgr', `select * from audience_list()`, [], 'manager audience_list forbidden');
const cc = (await as('anon', `select count(*)::int n from coupons`)).rows[0].n;
await as('mkt', `insert into coupons(code, discount_pct) values ('WINTER10', 10)`);
const cc2 = (await as('anon', `select count(*)::int n from coupons`)).rows[0].n;
cc2 === 0 ? ok('anon cannot list coupons') : bad('coupons visible ' + cc2);
const chk = (await as('anon', `select check_coupon('winter10') c`)).rows[0].c;
chk.valid && chk.discount_pct === 10 ? ok('check_coupon works (case-insensitive)') : bad('check_coupon');
await as('mkt', `update site_settings set value = jsonb_set(value, '{en,title}', '"New"') where key='seo'`);
const seo = (await db.query(`select value->'en'->>'title' t, updated_by from site_settings where key='seo'`)).rows[0];
seo.t === 'New' && seo.updated_by === U.mkt ? ok('marketer edits SEO (stamped updated_by)') : bad('seo');
const r0 = await as('mkt', `update site_settings set value = '{}' where key='contacts'`);
r0.affectedRows === 0 ? ok('marketer cannot touch contacts') : bad('contacts changed');
await as('mkt', `update tours set published=false where slug='phuket'`);
(await as('anon', `select jsonb_array_length(public_site()->'tours') n`)).rows[0].n === 4 ? ok('marketer unpublishes tour → site sees 4') : bad('unpublish');
await as('owner', `update tours set published=true, hot_until=current_date - 1 where slug='phuket'`);
(await as('anon', `select jsonb_array_length(public_site()->'tours') n`)).rows[0].n === 4 ? ok('expired hot_until hidden') : bad('hot_until');
const mt = await as('mkt', `update team set published=false`);
mt.affectedRows === 0 ? ok('marketer cannot edit team') : bad('team');
await expectErr('mkt', `select set_role($1,'admin')`, [U.mkt], 'marketer set_role forbidden');
await expectErr('owner', `select set_role($1,'client')`, [U.owner], 'owner cannot demote self');
await as('owner', `select set_role($1,'manager')`, [U.mkt]);
const aud2 = (await as('owner', `select table_name, action, actor from audit_log order by id`)).rows;
console.log('    audit:', aud2.map(a => a.table_name + ':' + a.action).join(' '));
aud2.some(a => a.table_name === 'profiles') ? ok('role change audited') : bad('role audit');
(await as('mgr', `select count(*)::int n from audit_log`)).rows[0].n === 0 ? ok('manager cannot read audit') : bad('audit leak');
const us = (await as('owner', `select * from users_list()`)).rows;
us.length === 4 ? ok('owner users_list: 4 with emails') : bad('users ' + us.length);
const us2 = (await as('mgr', `select * from users_list()`)).rows;
us2.every(u => u.role !== 'client') ? ok('manager users_list: team only') : bad('users leak');
await expectErr('mgr', `insert into lead_activity(lead_id, actor, kind, body) values ($1, $2, 'note', 'x')`, [lid, U.owner], 'activity actor spoof rejected');
await as('mgr', `insert into lead_activity(lead_id, actor, kind, body) values ($1, $2, 'note', 'called')`, [lid, U.mgr]);
ok('manager adds note');
const del = await as('mgr', `delete from leads where id=$1`, [lid]); del.affectedRows === 0 ? ok('manager cannot delete leads (0 rows)') : bad('manager deleted a lead');
const del2 = await as('owner', `select count(*)::int n from leads`); del2.rows[0].n === 1 ? ok('owner still sees the lead') : bad('lead gone');
const ps2 = (await as('anon', `select public_site() s`)).rows[0].s;
('margin_pct' in ps2.settings.company) ? bad('margin leaks to public_site') : ok('margin_pct hidden from public_site (licence still there: ' + ps2.settings.company.licence + ')');

// ---- sales are registered by hand: no payment on the site ----
const sold = (await as('mgr', `insert into leads(name, phone, source, status, value, profit, first_response_at, closed_at)
  values ('Walk In', '+374 91 000111', 'walk_in', 'won', 1800, 200, now(), now() - interval '2 days') returning id, closed_at`)).rows[0];
sold.closed_at && Date.now() - new Date(sold.closed_at) > 86400e3 ? ok('manager registers a sale made on the spot, back-dated') : bad('direct sale');
const l2 = (await as('mgr', `insert into leads(name, phone, source, status, coupon_code) values ('Coupon Client', '+374 91 000222', 'phone', 'contacted', 'winter10') returning id`)).rows[0].id;
await as('mgr', `update leads set status='won', value=900, closed_at=now() - interval '3 days' where id=$1`, [l2]);
await as('mgr', `update leads set closed_at=now() - interval '3 days' where id=$1`, [l2]);   // what the panel sends when the sale is back-dated
const bd = (await db.query(`select closed_at from leads where id=$1`, [l2])).rows[0].closed_at;
Date.now() - new Date(bd) > 2 * 86400e3 ? ok('sale date can be set after closing') : bad('sale date not kept');
const used = async () => (await db.query(`select used_count from coupons where code='WINTER10'`)).rows[0].used_count;
(await used()) === 1 ? ok('promo code counted as used on the sale') : bad('used_count ' + (await used()));
await as('mgr', `update leads set status='quoted' where id=$1`, [l2]);
(await used()) === 0 ? ok('promo code released when the sale is reopened') : bad('used_count after reopen ' + (await used()));
