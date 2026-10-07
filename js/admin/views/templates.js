// WhatsApp reply templates — one click from a lead card, with the client's
// name, destination and the manager's name filled in.
// Two of them are special (wa_templates.kind, 090_reminders.sql): the texts of the flight
// reminders «хорошего полёта» and «с возвращением», one per language. The database fills
// them in itself, so they cannot be deleted or moved to another language — only reworded.
import { h, clear, icon, toast, drawer, confirmDlg, field, input, textarea, select, sortable, pageHead } from '../ui.js';
import { fillTemplate } from './common.js';
import { KINDS, KIND_NAME, reminderFill, reminderDefault, waSettings } from '../reminders.js';

export default async function templatesView(root, ctx) {
  let rows = await ctx.api.list('wa_templates');
  const review = waSettings(await ctx.settings().catch(() => ({}))).review_url;
  const list = h('div.list'), sys = h('div.list');
  root.append(pageHead('Шаблоны ответов', 'Готовые сообщения для WhatsApp. В карточке продажи вы выбираете шаблон — имя клиента, направление и имя менеджера подставятся сами.',
    h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Новый шаблон')),
    h('div.section-t', 'Напоминания о вылетах'),
    h('p.muted', { style: { margin: '-4px 0 12px', fontSize: '13px' } }, 'Эти тексты панель сама подставляет в блок «Написать сегодня» на сводке и в ежедневное письмо — на языке клиента. По одному на язык.'),
    sys, h('div.section-t', 'Ответы в переписке'), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('wa_templates', ids); toast('Порядок сохранён'); } catch (e) { ctx.err(e); } });
  const sample = { name: 'Анна Петросян', tour: 'Дубай', manager: ctx.me.full_name };
  const TOUR_SAMPLE = { ru: 'Дубай', en: 'Dubai', hy: 'Դուբայ' };
  // a reminder is filled in the way the database does it; a reply — the way the sale card does
  const preview = (t, body = t.body) => (t.kind ? reminderFill(body, sample.name, TOUR_SAMPLE[t.lang], t.kind === 'welcome_back' ? review : '') : fillTemplate(body, sample));
  function paint() {
    clear(list); clear(sys);
    rows.filter((t) => t.kind).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.sort - b.sort).forEach((t) => sys.appendChild(h('div.item', { dataset: { id: t.id }, style: { alignItems: 'flex-start', cursor: 'pointer' }, onclick: () => edit(t) },
      h('div.item__main', h('div.row', h('b', KIND_NAME[t.kind]), h('span.tag', t.lang.toUpperCase())), h('div.dim', { style: { fontSize: '13px', whiteSpace: 'pre-wrap', marginTop: '4px' } }, preview(t))))));
    rows.filter((t) => !t.kind).sort((a, b) => a.sort - b.sort).forEach((t) => list.appendChild(h('div.item', { draggable: 'true', dataset: { id: t.id }, style: { alignItems: 'flex-start', cursor: 'pointer' }, onclick: (e) => { if (!e.target.closest('.item__grip')) edit(t); } },
      h('span.item__grip', icon('grip')),
      h('div.item__main', h('div.row', h('b', t.title), h('span.tag', t.lang.toUpperCase())), h('div.dim', { style: { fontSize: '13px', whiteSpace: 'pre-wrap', marginTop: '4px' } }, fillTemplate(t.body, sample))))));
    if (!rows.some((t) => !t.kind)) list.appendChild(h('div.card', h('div.empty', 'Шаблонов нет')));
  }
  function edit(t) {
    const d = { title: '', lang: 'ru', body: '', ...t };
    const pv = h('div.utm-out', { style: { fontFamily: 'var(--font)', whiteSpace: 'pre-wrap' } });
    const show = () => { pv.textContent = preview(d); };
    const ta = textarea(d.body, { rows: 6, oninput: (v) => { d.body = v; show(); } });
    const ins = (tag) => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(tag, s, e, 'end'); ta.focus(); d.body = ta.value; show(); };
    show();
    const langSel = select([['ru', 'Русский'], ['hy', 'Армянский'], ['en', 'Английский']], d.lang, (v) => { d.lang = v; show(); });
    langSel.disabled = !!t.kind;
    const tags = t.kind ? [['{name}', 'Имя клиента'], ['{tour}', 'Направление'], ...(t.kind === 'welcome_back' ? [['[: {review}]', 'Ссылка для отзыва']] : [])]
      : [['{name}', 'Имя клиента'], ['{tour}', 'Направление'], ['{manager}', 'Имя менеджера']];
    drawer({
      title: t.kind ? KIND_NAME[t.kind] + ' · ' + t.lang.toUpperCase() : t.id ? t.title : 'Новый шаблон',
      sub: t.kind ? (t.kind === 'bon_voyage' ? 'Клиенту пишут накануне вылета' : 'Клиенту пишут на следующий день после возвращения') : null,
      body: () => h('div.stack',
        h('div.grid2', field('Название', input(d.title, { placeholder: 'Первый ответ', oninput: (v) => { d.title = v; } })), field('Язык', langSel, t.kind ? 'У напоминания — один текст на язык' : null)),
        field('Текст', ta, t.kind ? 'Подставляются имя (первое слово) и направление на языке клиента. Кусок в [квадратных скобках] пропадает целиком, если подставить нечего: у продажи нет направления или не задана ссылка для отзыва.' : null),
        h('div.chips', tags.map(([tag, l]) => h('button.chip', { type: 'button', onclick: () => ins(tag) }, '+ ' + l))),
        h('div.section-t', 'Так увидит клиент'), pv),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        t.kind ? h('button.btn.btn--ghost', { title: 'Вернуть текст, с которым панель была установлена', onclick: () => { ta.value = d.body = reminderDefault(t.kind, t.lang); show(); } }, 'Исходный текст')
        : t.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить шаблон?'))) return; try { await ctx.api.remove('wa_templates', t.id); rows = rows.filter((x) => x.id !== t.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash')) : h('span'),
        h('button.btn.btn--primary', { onclick: async () => {
          if (!d.title.trim() || !d.body.trim()) { toast('Нужны название и текст', 'bad'); return; }
          try { const u = await ctx.api.save('wa_templates', { ...d, sort: d.sort ?? rows.length }); if (t.id) Object.assign(t, u); else rows.push(u); toast('Сохранено'); api.close(); paint(); } catch (e) { ctx.err(e); }
        } }, 'Сохранить')),
    });
  }
  paint();
}
