// WhatsApp reply templates — one click from a lead card, with the client's
// name, destination and the manager's name filled in.
import { h, clear, icon, toast, drawer, confirmDlg, field, input, textarea, select, sortable, pageHead } from '../ui.js';
import { fillTemplate } from './common.js';

export default async function templatesView(root, ctx) {
  let rows = await ctx.api.list('wa_templates');
  const list = h('div.list');
  root.append(pageHead('Шаблоны ответов', 'Готовые сообщения для WhatsApp. В карточке заявки менеджер выбирает шаблон — имя клиента, направление и имя менеджера подставятся сами.',
    h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Новый шаблон')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('wa_templates', ids); toast('Порядок сохранён'); } catch (e) { ctx.err(e); } });
  const sample = { name: 'Анна Петросян', tour: 'Дубай', manager: ctx.me.full_name };
  function paint() {
    clear(list);
    rows.slice().sort((a, b) => a.sort - b.sort).forEach((t) => list.appendChild(h('div.item', { draggable: 'true', dataset: { id: t.id }, style: { alignItems: 'flex-start', cursor: 'pointer' }, onclick: (e) => { if (!e.target.closest('.item__grip')) edit(t); } },
      h('span.item__grip', icon('grip')),
      h('div.item__main', h('div.row', h('b', t.title), h('span.tag', t.lang.toUpperCase())), h('div.dim', { style: { fontSize: '13px', whiteSpace: 'pre-wrap', marginTop: '4px' } }, fillTemplate(t.body, sample))))));
    if (!rows.length) list.appendChild(h('div.card', h('div.empty', 'Шаблонов нет')));
  }
  function edit(t) {
    const d = { title: '', lang: 'ru', body: '', ...t };
    const pv = h('div.utm-out', { style: { fontFamily: 'var(--font)', whiteSpace: 'pre-wrap' } });
    const ta = textarea(d.body, { rows: 6, oninput: (v) => { d.body = v; pv.textContent = fillTemplate(v, sample); } });
    const ins = (tag) => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(tag, s, e, 'end'); ta.focus(); d.body = ta.value; pv.textContent = fillTemplate(d.body, sample); };
    pv.textContent = fillTemplate(d.body, sample);
    drawer({
      title: t.id ? t.title : 'Новый шаблон',
      body: () => h('div.stack',
        h('div.grid2', field('Название', input(d.title, { placeholder: 'Первый ответ', oninput: (v) => { d.title = v; } })), field('Язык', select([['ru', 'Русский'], ['hy', 'Армянский'], ['en', 'Английский']], d.lang, (v) => { d.lang = v; }))),
        field('Текст', ta),
        h('div.chips', [['{name}', 'Имя клиента'], ['{tour}', 'Направление'], ['{manager}', 'Имя менеджера']].map(([tag, l]) => h('button.chip', { type: 'button', onclick: () => ins(tag) }, '+ ' + l))),
        h('div.section-t', 'Так увидит клиент'), pv),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        t.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить шаблон?'))) return; try { await ctx.api.remove('wa_templates', t.id); rows = rows.filter((x) => x.id !== t.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash')) : h('span'),
        h('button.btn.btn--primary', { onclick: async () => {
          if (!d.title.trim() || !d.body.trim()) { toast('Нужны название и текст', 'bad'); return; }
          try { const u = await ctx.api.save('wa_templates', { ...d, sort: d.sort ?? rows.length }); if (t.id) Object.assign(t, u); else rows.push(u); toast('Сохранено'); api.close(); paint(); } catch (e) { ctx.err(e); }
        } }, 'Сохранить')),
    });
  }
  paint();
}
