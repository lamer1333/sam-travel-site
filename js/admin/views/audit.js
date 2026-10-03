// Audit log: who changed what, when — with a field-level diff.
import { h, mount, fmt, drawer, select, table, pageHead } from '../ui.js';
import { ROLE_NAMES } from '../main.js';

const TABLES = { site_settings: 'Настройки сайта', tours: 'Туры', reviews: 'Отзывы', team: 'Команда', reels: 'Рилсы', promos: 'Промо', campaigns: 'Кампании', coupons: 'Промокоды', wa_templates: 'Шаблоны', profiles: 'Роли' };
const ACT = { insert: ['ok', 'Создано'], update: ['warn', 'Изменено'], delete: ['bad', 'Удалено'] };
const SKIP = ['updated_at', 'updated_by', 'created_at'];

export default async function auditView(root, ctx) {
  const [rows] = await Promise.all([ctx.api.audit(400), ctx.users().catch(() => [])]);
  const f = { table: '', actor: '' };
  const box = h('div');
  const actors = Array.from(new Set(rows.map((r) => r.actor).filter(Boolean)));
  root.append(pageHead('Журнал изменений', 'Каждое изменение контента, промо, кампаний, промокодов, настроек и ролей. Записывает база данных — подделать или стереть из панели нельзя.'),
    h('div.toolbar',
      select([['', 'Все разделы'], ...Object.entries(TABLES)], '', (v) => { f.table = v; paint(); }),
      select([['', 'Все сотрудники'], ...actors.map((a) => [a, ctx.staffName(a)])], '', (v) => { f.actor = v; paint(); })), box);
  function paint() {
    const data = rows.filter((r) => (!f.table || r.table_name === f.table) && (!f.actor || r.actor === f.actor));
    mount(box, h('div.card.card--flush', table({ rows: data, onRow: open, empty: 'Изменений нет', columns: [
      { key: 'at', label: 'Когда', render: (r) => h('span', { title: fmt.dt(r.at) }, fmt.ago(r.at)) },
      { key: 'actor', label: 'Кто', render: (r) => r.actor ? ctx.staffName(r.actor) : h('span.muted', 'система') },
      { key: 'action', label: 'Действие', render: (r) => h('span.badge.badge--' + ACT[r.action][0], ACT[r.action][1]) },
      { key: 'table_name', label: 'Раздел', render: (r) => TABLES[r.table_name] || r.table_name },
      { key: 'what', label: 'Что', render: (r) => h('span.dim', title(r)) },
      { key: 'fields', label: 'Поля', render: (r) => h('span.muted', changed(r).slice(0, 4).join(', ')) },
    ] })));
  }
  function open(r) {
    const keys = r.action === 'update' ? changed(r) : Object.keys(r.after || r.before || {}).filter((k) => !SKIP.includes(k));
    drawer({ title: (TABLES[r.table_name] || r.table_name) + ': ' + title(r), sub: ACT[r.action][1] + ' · ' + fmt.dt(r.at) + ' · ' + (r.actor ? ctx.staffName(r.actor) : 'система'),
      body: () => h('div.diff', keys.map((k) => h('div', h('b', k), ': ',
        r.action !== 'insert' ? h('del', show(r.before && r.before[k])) : null, r.action === 'update' ? ' → ' : null,
        r.action !== 'delete' ? h('ins', show(r.after && r.after[k])) : null))) });
  }
  function title(r) {
    const x = r.after || r.before || {};
    if (r.table_name === 'profiles') return (x.full_name || '') + ' → ' + (ROLE_NAMES[x.role] || x.role);
    if (r.table_name === 'site_settings') return ({ contacts: 'контакты', company: 'реквизиты', hours: 'рабочее время', seo: 'SEO', analytics: 'ID аналитики', stats: 'цифры' }[x.key] || x.key);
    return x.name || x.code || x.author || x.title || (x.i18n && ((x.i18n.ru && (x.i18n.ru.card_title || x.i18n.ru.name || x.i18n.ru.title)) || (x.i18n.en && (x.i18n.en.card_title || x.i18n.en.name)))) || x.url || x.slug || x.id || '';
  }
  paint();
}
function changed(r) {
  if (r.action !== 'update' || !r.before || !r.after) return [];
  return Object.keys(r.after).filter((k) => !SKIP.includes(k) && JSON.stringify(r.after[k]) !== JSON.stringify(r.before[k]));
}
function show(v) { if (v == null || v === '') return '∅'; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 400 ? s.slice(0, 400) + '…' : s; }
