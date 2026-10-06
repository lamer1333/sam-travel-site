// ---------------------------------------------------------------------------
// Data access for the panels. Two implementations with one interface:
//   LiveApi — Supabase (tables + RPCs from supabase/migrations/), RLS enforced
//   DemoApi — generated data in this browser (admin.html?demo), see demo.js
// Views only ever talk to this interface.
// ---------------------------------------------------------------------------

export const LEADS_WINDOW_DAYS = 90;   // closed leads older than this come by search and pages
const PAGE = 500;
const OPEN = ['new', 'contacted', 'quoted'];
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

  // ---- leads ----
  // PostgREST gives at most `max rows` (1000 by default) per request, so nothing here asks
  // for "everything" in one go: a list is read page by page until the server's own count.
  async pages(make) {
    const out = [];
    for (;;) {
      const { data, error, count } = await make().order('created_at', { ascending: false }).order('id').range(out.length, out.length + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (!data.length || count == null || out.length >= count) return out;
    }
  }
  /** What the panel keeps in memory: every open lead + the ones closed (or created) in the last `days`. */
  async leads({ days = LEADS_WINDOW_DAYS } = {}) {
    const since = JSON.stringify(new Date(Date.now() - days * 86400e3).toISOString());
    const sel = () => this.sb.from('leads').select('*', { count: 'exact' });
    const [open, closed] = await Promise.all([
      this.pages(() => sel().in('status', OPEN)),
      this.pages(() => sel().in('status', ['won', 'lost', 'spam']).or(`closed_at.gte.${since},created_at.gte.${since}`)),
    ]);
    return open.concat(closed).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  /** Everything else: one page of a search over all leads, newest first → { rows, total }. */
  async findLeads({ q, phone, source, manager, tour, spam, mine, noProfit, since, offset = 0, limit = PAGE } = {}) {
    let r = this.sb.from('leads').select('*', { count: 'exact' });
    if (!spam) r = r.neq('status', 'spam');
    if (source) r = r.eq('source', source);
    if (manager) r = manager === 'none' ? r.is('assigned_to', null) : r.eq('assigned_to', manager);
    if (mine) r = r.eq('assigned_to', mine);
    if (tour) r = r.eq('tour', tour);
    if (since) r = r.gte('created_at', since);
    if (noProfit) r = r.eq('status', 'won').or('profit.is.null,value.is.null,value.lte.0');
    if (phone) r = r.like('phone_digits', '%' + String(phone).replace(/\D/g, '') + '%');
    if (q) {
      const like = JSON.stringify('%' + q + '%'), digits = q.replace(/\D/g, '');
      const any = [`name.ilike.${like}`, `message.ilike.${like}`];
      if (/^[\p{L}\p{N}_-]+$/u.test(q)) any.push(`tags.cs.{${q}}`);   // a tag is one word
      if (digits.length >= 3) any.push(`phone_digits.like.%${digits}%`);
      r = r.or(any.join(','));
    }
    const { data, error, count } = await r.order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
    if (error) throw error;
    return { rows: data, total: count == null ? offset + data.length : count };
  }
  async lead(id) { return must(await this.sb.from('leads').select('*').eq('id', id).maybeSingle()); }
  async leadActivity(id) { return must(await this.sb.from('lead_activity').select('*').eq('lead_id', id).order('created_at')); }
  // The rules of a sale (amount, income, sale date, currency, lost reason) live in the
  // leads_guard trigger, 010_guards.sql: one request, and the database answers with the row
  // as it really is — or with an error errText() below translates.
  async updateLead(id, patch) { return must(await this.sb.from('leads').update(clean(patch)).eq('id', id).select().single()); }
  async updateLeads(ids, patch) { must(await this.sb.from('leads').update(clean(patch)).in('id', ids)); }
  async createLead(row) {
    const l = must(await this.sb.from('leads').insert(clean(row)).select().single());
    await this.addActivity(l.id, 'system', 'Добавлена вручную').catch(() => {});
    return l;
  }
  async deleteLead(id) { must(await this.sb.from('leads').delete().eq('id', id)); }
  async addActivity(lead_id, kind, body, meta = {}) {
    const me = (await this.session()).user.id;
    return must(await this.sb.from('lead_activity').insert({ lead_id, kind, body, meta, actor: me }).select().single());
  }
  /** cb(lead) for a new lead; onChange('UPDATE'|'DELETE', row) when a colleague edits or removes one */
  onLead(cb, onChange) {
    const ch = this.sb.channel('leads-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (p) => cb(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (p) => onChange && onChange('UPDATE', p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads' }, (p) => onChange && onChange('DELETE', p.old))
      .subscribe();
    return () => this.sb.removeChannel(ch);
  }

  // ---- people ----
  async users() { return must(await this.sb.rpc('users_list')); }
  async setRole(id, role) { must(await this.sb.rpc('set_role', { p_user: id, p_role: role })); }
  async audience() { return must(await this.sb.rpc('audience_list')); }

  // ---- generic content tables ----
  async list(table, order = 'sort') {
    let q = this.sb.from(table).select('*');
    q = order === 'sort' ? q.order('sort').order('created_at') : q.order(order, { ascending: false });
    return must(await q);
  }
  async save(table, row) { return must(await this.sb.from(table).upsert(clean(row)).select().single()); }
  async remove(table, id) { must(await this.sb.from(table).delete().eq('id', id)); }
  async reorder(table, ids) {
    await Promise.all(ids.map((id, i) => this.sb.from(table).update({ sort: i }).eq('id', id).then(must)));
  }

  // ---- settings ----
  async settings() {
    const rows = must(await this.sb.from('site_settings').select('key,value'));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async saveSetting(key, value) { must(await this.sb.from('site_settings').upsert({ key, value })); }

  // ---- analytics / audit ----
  // Every number of the reports is counted by the database (030_stats.sql); the panel only shows it.
  async stats(from, to) { return must(await this.sb.rpc('stats_traffic', { p_from: from.toISOString(), p_to: to.toISOString() })); }
  async sales(from, to) { return must(await this.sb.rpc('stats_sales', { p_from: from.toISOString(), p_to: to.toISOString() })); }
  async couponStats() { return must(await this.sb.rpc('stats_coupons')); }
  async audit(limit = 300) { return must(await this.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)); }

  // ---- files ----
  async upload(file, folder = 'uploads') {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    must(await this.sb.storage.from('media').upload(path, file, { cacheControl: '31536000', upsert: false }));
    return this.sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  // the site reads the database itself; nothing to publish
  publish() {}
}

/** Friendly Russian text for the errors people actually hit */
export function errText(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/invalid login credentials/i.test(m)) return 'Неверный email или пароль';
  if (/forbidden|permission denied|row-level security/i.test(m)) return 'Недостаточно прав для этого действия';
  if (/sale_needs_value/.test(m)) return 'У продажи должна быть сумма больше нуля';
  if (/profit_out_of_range/.test(m)) return 'Доход агентства — от нуля до суммы продажи; сначала укажите сумму';
  if (/value_negative/.test(m)) return 'Сумма не может быть отрицательной';
  if (/sale_date_in_future/.test(m)) return 'Дата продажи не может быть в будущем';
  if (/lost_reason_required/.test(m)) return 'Укажите причину отказа';
  if (/last_owner/.test(m)) return 'Это последний владелец — сначала назначьте другого';
  if (/role_change_forbidden/.test(m)) return 'Роль меняет только владелец в разделе «Клиенты и команда»';
  if (/profile_field_forbidden/.test(m)) return 'Это поле профиля менять нельзя';
  if (/cannot_change_own_role/.test(m)) return 'Свою роль менять нельзя — попросите другого владельца';
  if (/duplicate key.*utm_campaign/i.test(m)) return 'Кампания с таким utm_campaign уже есть';
  if (/duplicate key.*code/i.test(m)) return 'Такой промокод уже существует';
  if (/duplicate key.*slug/i.test(m)) return 'Тур с таким адресом (slug) уже есть';
  if (/violates check constraint.*url/i.test(m)) return 'Нужна ссылка вида https://www.instagram.com/reel/…';
  if (/Could not find the function|does not exist/i.test(m)) return 'База не обновлена: накатите миграции из supabase/migrations/';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером';
  return m;
}
