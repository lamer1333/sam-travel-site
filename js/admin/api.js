// ---------------------------------------------------------------------------
// Data access for the panels. Two implementations with one interface:
//   LiveApi — Supabase (tables + RPCs from supabase/migrations/), RLS enforced
//   DemoApi — generated data in this browser (admin.html?demo), see demo.js
// Views only ever talk to this interface.
// ---------------------------------------------------------------------------

import { refNorm } from './metrics.js';

const PAGE = 500;
const READONLY = ['created_at', 'updated_at', 'updated_by', 'phone_digits'];
const clean = (row) => { const r = { ...row }; READONLY.forEach((k) => delete r[k]); if (!r.id) delete r.id; return r; };
function must({ data, error }) { if (error) throw error; return data; }

export class LiveApi {
  constructor(sb) { this.sb = sb; this.mode = 'live'; }

  // ---- auth ----
  async session() { const { data } = await this.sb.auth.getSession(); return data.session; }
  async signIn(email, password) { must(await this.sb.auth.signInWithPassword({ email, password })); }
  async signOut() { await this.sb.auth.signOut(); }
  async whoami() { return must(await this.sb.rpc('whoami')); }

  // ---- sales journal ----
  // The site has no request form (TZ-BACKEND.md §4.11): the `leads` table holds only what the
  // owner typed in — sales (won) and refunds (lost). PostgREST gives at most `max rows`
  // (1000 by default) per request, so the journal is read page by page → { rows, total }.
  // `depart` = { from, to } (flight days, 'YYYY-MM-DD') or { none: true } — the «Вылет» filter; soonest flight first.
  async journal({ q, status, noProfit, since, depart, offset = 0, limit = PAGE } = {}) {
    let r = this.sb.from('leads').select('*', { count: 'exact' }).in('status', status ? [status] : ['won', 'lost']);
    if (since) r = r.gte('closed_at', since);
    if (noProfit) r = r.eq('status', 'won').is('profit', null);
    if (depart) r = depart.none ? r.is('depart_on', null) : r.gte('depart_on', depart.from).lte('depart_on', depart.to);
    if (q) {
      const like = JSON.stringify('%' + q + '%'), digits = q.replace(/\D/g, ''), ref = refNorm(q) || '';   // the number typed on the Russian keyboard is found too, as in the demo
      const any = [`name.ilike.${like}`, `message.ilike.${like}`];
      if (/^[\p{L}\p{N}_-]+$/u.test(q)) any.push(`tags.cs.{${q}}`);   // a tag is one word
      if (digits.length >= 3) any.push(`phone_digits.like.%${digits}%`);
      if (ref.length === 5) any.push(`ref.eq.${ref}`);
      r = r.or(any.join(','));
    }
    if (depart && !depart.none) r = r.order('depart_on');
    const { data, error, count } = await r.order('closed_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
    if (error) throw error;
    return { rows: data, total: count == null ? offset + data.length : count };
  }
  async sale(id) { return must(await this.sb.from('leads').select('*').eq('id', id).maybeSingle()); }
  async saleActivity(id) { return must(await this.sb.from('lead_activity').select('*').eq('lead_id', id).order('created_at')); }
  // The rules of a sale live in the database: leads_guard (010_guards.sql) keeps the amount,
  // the income, the sale date, the currency and the refund reason; leads_attribution
  // (070_whatsapp.sql) fills the advert tags, tour, language and device from the reference
  // number. One request, and the database answers with the row as it really is — or with an
  // error errText() below translates.
  // The first line of the history («Продажа внесена») is written by the database
  // (leads_log_insert in 100_security.sql): the panel may not insert `system` lines.
  async createSale(row) { return must(await this.sb.from('leads').insert(clean(row)).select().single()); }
  async updateSale(id, patch) { return must(await this.sb.from('leads').update(clean(patch)).eq('id', id).select().single()); }
  async deleteSale(id) { must(await this.sb.from('leads').delete().eq('id', id)); }
  async addActivity(lead_id, kind, body, meta = {}) {
    const me = (await this.session()).user.id;
    return must(await this.sb.from('lead_activity').insert({ lead_id, kind, body, meta, actor: me }).select().single());
  }
  /** what the site knows about the visit with this reference number («№ K7M2X» at the end of a WhatsApp message), or null */
  async waRef(code) { return must(await this.sb.rpc('wa_ref', { p_code: code })); }

  // ---- flight reminders (090_reminders.sql) ----
  // The database builds the list, the text in the client's language and the wa.me link; the
  // message itself is sent by a person from their own phone.
  /** { today, enabled, items: who to write to today, upcoming: flights within 7 days } */
  async reminders() { return must(await this.sb.rpc('reminders_today')); }
  /** mark a reminder as sent (done = false takes the mark off) */
  async reminderDone(id, done = true) { return must(await this.sb.rpc('reminder_done', { p_id: id, p_done: done })); }

  // ---- people ----
  async users() { return must(await this.sb.rpc('users_list')); }
  async setRole(id, role) { must(await this.sb.rpc('set_role', { p_user: id, p_role: role })); }
  async audience() { return must(await this.sb.rpc('audience_list')); }
  /** month 1–12; clients with consent and a confirmed address — owner and marketer only */
  async birthdays(month) { return must(await this.sb.rpc('birthdays', { p_month: month })); }

  // ---- generic content tables ----
  async list(table, order = 'sort') {
    let q = this.sb.from(table).select('*');
    q = order === 'sort' ? q.order('sort').order('created_at') : q.order(order, { ascending: false });
    return must(await q);
  }
  async save(table, row) { return must(await this.sb.from(table).upsert(clean(row)).select().single()); }
  /** the role «Контент» changes only the photo of a team member — an update of one column, never an upsert */
  async saveTeamPhoto(id, url) { return must(await this.sb.from('team').update({ photo_url: url || null }).eq('id', id).select().single()); }
  async remove(table, id) { must(await this.sb.from(table).delete().eq('id', id)); }
  async reorder(table, ids) {
    await Promise.all(ids.map((id, i) => this.sb.from(table).update({ sort: i }).eq('id', id).then(must)));
  }

  // ---- settings ----
  async settings() {
    const rows = must(await this.sb.from('site_settings').select('key,value'));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  // The marketer may UPDATE seo / analytics / stats but not INSERT (the policy of 002_admin.sql),
  // and an upsert is an INSERT first: so update, and insert only when there was no such row.
  async saveSetting(key, value) {
    const rows = must(await this.sb.from('site_settings').update({ value }).eq('key', key).select('key'));
    if (!rows || !rows.length) must(await this.sb.from('site_settings').insert({ key, value }));
  }

  // ---- analytics / audit ----
  // Every number of the reports is counted by the database (070_whatsapp.sql); the panel only shows it.
  async stats(from, to) { return must(await this.sb.rpc('stats_traffic', { p_from: from.toISOString(), p_to: to.toISOString() })); }
  async sales(from, to) { return must(await this.sb.rpc('stats_sales', { p_from: from.toISOString(), p_to: to.toISOString() })); }
  async couponStats() { return must(await this.sb.rpc('stats_coupons')); }
  /** «Готовность сайта»: is the daily letter with the flight reminders set up and leaving (owner only; 110_fixes.sql) */
  async notifyStatus() { return must(await this.sb.rpc('notify_status')); }
  async audit(limit = 300) { return must(await this.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)); }

  // ---- files ----
  async upload(file, folder = 'uploads') {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    must(await this.sb.storage.from('media').upload(path, file, { cacheControl: '31536000', upsert: false }));
    return this.sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  /** the address to put into <img> / background-image (the demo keeps its photos elsewhere, see DemoApi.src); '' for anything that is not a file of our bucket */
  src(url) { return mediaUrlOk(url, (window.SAM_SUPABASE || {}).url) ? url : ''; }
  /** Delete files of the `media` bucket by their public addresses — the photos a newer one replaced. Addresses that are not ours are skipped. */
  async removeFiles(urls) {
    const paths = (urls || []).map(mediaPath).filter(Boolean);
    if (paths.length) must(await this.sb.storage.from('media').remove(paths));
  }

  // ---- history of a content row (080_content.sql) ----
  /** past versions of a tour, review, reel or team member, newest first: [{ id, at, action, actor, actor_name, version }] */
  async history(table, id) { return must(await this.sb.rpc('row_history', { p_table: table, p_id: id })); }
  /** «Вернуть эту версию» → { row, photo_kept }; the database checks the rights and writes the return to the audit log */
  async restore(auditId) { return must(await this.sb.rpc('restore_version', { p_audit: auditId })); }

  // the site reads the database itself; nothing to publish
  publish() {}
}

/**
 * Is this the public address of a file of OUR `media` bucket? The address goes into CSS
 * (background-image), so nothing else is let through: another host, a path with quotes or
 * brackets. The database keeps the same rule (media_url_ok in 100_security.sql).
 */
export function mediaUrlOk(url, base) {
  const u = String(url == null ? '' : url), b = String(base || '').replace(/\/+$/, '') + '/storage/v1/object/public/media/';
  return b.startsWith('https://') && u.startsWith(b) && /^[A-Za-z0-9._/-]{1,200}$/.test(u.slice(b.length));
}

/** 'https://…/storage/v1/object/public/media/content/a.webp' → 'content/a.webp'; null for anything that is not a file of the bucket */
export function mediaPath(url) {
  const m = /\/storage\/v1\/object\/public\/media\/([^?#]+)/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Friendly Russian text for the errors people actually hit */
export function errText(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/invalid login credentials/i.test(m)) return 'Неверный email или пароль';
  if (/forbidden|permission denied|row-level security/i.test(m)) return 'Недостаточно прав для этого действия';
  if (/bad_month/.test(m)) return 'Месяц — число от 1 до 12';
  if (/team_photo_only/.test(m)) return 'В «Команде» вы меняете только фото. Имя, должность и состав команды правит владелец';
  if (/rate_limited/.test(m)) return 'Слишком много попыток подряд — подождите минуту';
  if (/leads_money_not_nan|campaigns_spend_ok/.test(m)) return 'Сумма должна быть числом не меньше нуля';
  if (/tours_inc_ok/.test(m)) return '«Что входит» — список строк, каждая не длиннее 200 знаков';
  if (/photo_(hero_)?url_ok/.test(m)) return 'Фото должно быть загружено через панель — ссылки на другие сайты не принимаются';
  if (/tours_photo_class_known/.test(m)) return 'Фон тура выбирается из восьми встроенных';
  if (/profiles_(full_name|phone)_len|profiles_consent_source_known/.test(m)) return 'Слишком длинное имя или телефон в профиле';
  if (/sale_needs_value/.test(m)) return 'У продажи должна быть сумма больше нуля';
  if (/profit_out_of_range/.test(m)) return 'Доход агентства — от нуля до суммы продажи; сначала укажите сумму';
  if (/value_negative/.test(m)) return 'Сумма не может быть отрицательной';
  if (/sale_date_in_future/.test(m)) return 'Дата продажи не может быть в будущем';
  if (/lost_reason_required/.test(m)) return 'Укажите причину возврата';
  if (/return_before_depart/.test(m)) return 'Дата возвращения не может быть раньше даты вылета';
  if (/wa_auto_unavailable/.test(m)) return 'Автоматическая отправка станет доступна после подключения WhatsApp Business Platform';
  if (/bad_mail_hour/.test(m)) return 'Час письма — целое число от 0 до 23';
  if (/bad_review_url/.test(m)) return 'Ссылка для отзыва должна начинаться с https://';
  if (/reminder_not_found/.test(m)) return 'Напоминание не найдено — обновите страницу';
  if (/duplicate key.*wa_templates_kind_lang/i.test(m)) return 'Текст этого напоминания на этом языке уже есть — правьте его';
  if (/leads_name_check/.test(m)) return 'Имя клиента — от 1 до 120 знаков';
  if (/leads_phone_check/.test(m)) return 'Телефон — от 5 до 40 знаков';
  if (/leads_message_check/.test(m)) return 'Текст «Что купили» — не длиннее 2000 знаков';
  if (/ref_invalid/.test(m)) return 'Номер обращения — 5 знаков из конца сообщения клиента, например K7M2X';
  if (/ref_not_found/.test(m)) return 'Обращения с таким номером за последние 90 дней нет. Проверьте номер или внесите продажу без него';
  if (/last_owner/.test(m)) return 'Это последний владелец — сначала назначьте другого';
  if (/role_change_forbidden/.test(m)) return 'Роль меняет только владелец в разделе «Клиенты и команда»';
  if (/profile_field_forbidden/.test(m)) return 'Это поле профиля менять нельзя';
  if (/cannot_change_own_role/.test(m)) return 'Свою роль менять нельзя — попросите другого владельца';
  if (/duplicate key.*utm_campaign/i.test(m)) return 'Кампания с таким utm_campaign уже есть';
  if (/duplicate key.*code/i.test(m)) return 'Такой промокод уже существует';
  if (/duplicate key.*slug/i.test(m)) return 'Тур с таким адресом (slug) уже есть';
  if (/violates check constraint.*url/i.test(m)) return 'Нужна ссылка вида https://www.instagram.com/reel/…';
  if (/tours_tags_known/.test(m)) return 'Тип тура выбирается из списка: Пляж, Город, Природа, Семейный';
  if (/version_not_found/.test(m)) return 'Этой версии в журнале уже нет';
  if (/not_content_table/.test(m)) return 'История и возврат версии есть только у туров, отзывов, рилсов и команды';
  if (/demo_storage_full/.test(m)) return 'Демо: в браузере закончилось место для фото. Нажмите «Сбросить демо» вверху страницы';
  if (/Payload too large|exceeded the maximum allowed size/i.test(m)) return 'Файл больше 5 МБ — хранилище его не принимает';
  if (/Could not find the function|does not exist/i.test(m)) return 'База не обновлена: накатите миграции из supabase/migrations/';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером';
  return m;
}
