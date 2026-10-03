// ---------------------------------------------------------------------------
// Data access for the panels. Two implementations with one interface:
//   LiveApi — Supabase (tables + RPCs from supabase/admin.sql), RLS enforced
//   DemoApi — generated data in this browser (admin.html?demo), see demo.js
// Views only ever talk to this interface.
// ---------------------------------------------------------------------------

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
  async leads({ since } = {}) {
    let q = this.sb.from('leads').select('*').order('created_at', { ascending: false }).limit(3000);
    if (since) q = q.gte('created_at', since);
    return must(await q);
  }
  async leadActivity(id) { return must(await this.sb.from('lead_activity').select('*').eq('lead_id', id).order('created_at')); }
  async updateLead(id, patch) { return must(await this.sb.from('leads').update(clean(patch)).eq('id', id).select().single()); }
  async updateLeads(ids, patch) { must(await this.sb.from('leads').update(clean(patch)).in('id', ids)); }
  async createLead(row) { return must(await this.sb.from('leads').insert(clean(row)).select().single()); }
  async deleteLead(id) { must(await this.sb.from('leads').delete().eq('id', id)); }
  async addActivity(lead_id, kind, body, meta = {}) {
    const me = (await this.session()).user.id;
    return must(await this.sb.from('lead_activity').insert({ lead_id, kind, body, meta, actor: me }).select().single());
  }
  onLead(cb) {
    const ch = this.sb.channel('leads-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (p) => cb(p.new))
      .subscribe();
    return () => this.sb.removeChannel(ch);
  }

  // ---- people ----
  async users() { return must(await this.sb.rpc('users_list')); }
  async setRole(id, role) { must(await this.sb.rpc('set_role', { p_user: id, p_role: role })); }
  async audience() { return must(await this.sb.rpc('audience_list')); }
  async bookings() { return must(await this.sb.from('bookings').select('*').order('created_at', { ascending: false }).limit(1000)); }
  async updateBooking(id, patch) { return must(await this.sb.from('bookings').update(patch).eq('id', id).select().single()); }

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
  async stats(from, to) { return must(await this.sb.rpc('stats_traffic', { p_from: from.toISOString(), p_to: to.toISOString() })); }
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
  if (/cannot_change_own_role/.test(m)) return 'Свою роль менять нельзя — попросите другого владельца';
  if (/duplicate key.*utm_campaign/i.test(m)) return 'Кампания с таким utm_campaign уже есть';
  if (/duplicate key.*code/i.test(m)) return 'Такой промокод уже существует';
  if (/duplicate key.*slug/i.test(m)) return 'Тур с таким адресом (slug) уже есть';
  if (/violates check constraint.*url/i.test(m)) return 'Нужна ссылка вида https://www.instagram.com/reel/…';
  if (/Could not find the function|does not exist/i.test(m)) return 'База не обновлена: выполните supabase/admin.sql в SQL Editor';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером';
  return m;
}
