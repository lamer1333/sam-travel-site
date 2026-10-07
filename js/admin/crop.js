// ---------------------------------------------------------------------------
// The photo loader with a crop frame (TZ-CONTENT.md §8). Every place on the site
// that takes an uploaded photo has a fixed shape; the person picks a file, moves
// and zooms it under a frame of that shape, and exactly what is inside the frame
// is saved in the size the site needs. A photo cannot be stretched or squeezed,
// and a file too small for the place is refused with the reason.
// No libraries: an <img> under a frame, and one canvas for the result.
// ---------------------------------------------------------------------------
import { h, modal } from './ui.js';

/** the places for photos — the table of TZ-CONTENT.md §8 */
export const FRAMES = {
  card:   { key: 'card', w: 1080, h: 1620, ratio: '2 : 3', place: 'Карточка тура в карусели', shape: 'Вертикальное фото', what: 'Фото направления. Главное — в центре: низ карточки уйдёт под текст' },
  hero:   { key: 'hero', w: 1600, h: 900, ratio: '16 : 9', place: 'Шапка в описании тура', shape: 'Горизонтальное фото', what: 'То же направление, широкий кадр' },
  person: { key: 'person', w: 900, h: 1200, ratio: '3 : 4', place: 'Фото сотрудника («О нас»)', shape: 'Вертикальное фото', what: 'Портрет по грудь' },
  avatar: { key: 'avatar', w: 400, h: 400, ratio: '1 : 1', place: 'Фото автора отзыва', shape: 'Квадратное фото', what: 'Лицо по центру — на сайте фото показывается кружком' },
};
/** «Вертикальное фото 2 : 3, не меньше 1080 × 1620» */
export const frameHint = (f) => `${f.shape} ${f.ratio}, не меньше ${f.w} × ${f.h}`;

const TYPES = /^image\/(jpeg|png|webp|avif)$/;
const MAX_FILE = 30e6;

// ---------- geometry (no DOM: the same numbers drive the screen and the result) ----------
/** does a w × h picture have enough pixels for the frame? */
export const fits = (w, h, f) => w >= f.w && h >= f.h;
/** the widest crop the frame allows on this picture (zoomed out) and the narrowest (zoomed in: 1 px of the photo per 1 px of the result) */
export function cropRange(iw, ih, f) { return { max: Math.min(iw, ih * f.w / f.h), min: f.w }; }
/** keep the crop inside the picture; cx, cy — its centre, cw — its width, all in the photo's pixels */
export function clampCrop(c, iw, ih, f) {
  const r = cropRange(iw, ih, f);
  const cw = Math.min(r.max, Math.max(r.min, c.cw)), ch = cw * f.h / f.w;
  return { cw, ch, cx: Math.min(iw - cw / 2, Math.max(cw / 2, c.cx)), cy: Math.min(ih - ch / 2, Math.max(ch / 2, c.cy)) };
}
/** the refusal: what the photo is, what the place (or each of the places) needs, and why */
export function tooSmallText(w, h, frames) {
  const fs = [].concat(frames);
  const need = fs.length === 1 ? `Для места «${fs[0].place}» нужно не меньше ${fs[0].w} × ${fs[0].h}` : 'Нужно не меньше: ' + fs.map((f) => `«${f.place}» — ${f.w} × ${f.h}`).join(', ');
  return `Фото слишком маленькое: ${w} × ${h}. ${need} — иначе на сайте оно будет мутным. Возьмите исходный файл с камеры или телефона, а не картинку из мессенджера.`;
}

// ---------- file → picture ----------
/** read a file the person picked → { img, w, h, release() }; throws an Error with a text for the person */
export function readImage(file) {
  return new Promise((res, rej) => {
    if (!file) return rej(new Error('Файл не выбран'));
    if (!TYPES.test(file.type)) return rej(new Error('Нужна фотография: JPEG, PNG, WebP или AVIF. Видео на сайт не загружается — рилсы добавляются ссылкой из Instagram.'));
    if (file.size > MAX_FILE) return rej(new Error('Файл больше 30 МБ — возьмите фото поменьше.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => res({ img, w: img.naturalWidth, h: img.naturalHeight, name: file.name, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Не получилось открыть файл как фотографию. Сохраните его в JPEG и попробуйте ещё раз.')); };
    img.src = url;
  });
}

/** what is inside the crop → a file of exactly f.w × f.h */
export function renderCrop(src, crop, f) {
  return new Promise((res, rej) => {
    const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(src.img, crop.cx - crop.cw / 2, crop.cy - crop.ch / 2, crop.cw, crop.ch, 0, 0, f.w, f.h);
    const base = String(src.name || 'photo').replace(/\.\w+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'photo';
    const done = (b, ext) => res(new File([b], `${base}-${f.key}.${ext}`, { type: b.type }));
    c.toBlob((b) => {
      if (b && b.type === 'image/webp') return done(b, 'webp');
      // a browser that cannot write WebP answers with PNG — far too heavy for a photo
      c.toBlob((j) => (j ? done(j, 'jpg') : rej(new Error('Браузер не смог сохранить кадр'))), 'image/jpeg', 0.88);
    }, 'image/webp', 0.85);
  });
}

// ---------- the dialog ----------
/**
 * Show the photo under the frame `f`. Resolves with the cropped File, or null when the
 * person cancelled. `step` — { n, of } for «Кадр 1 из 2».
 */
export function cropDialog(src, f, { step } = {}) {
  return new Promise((resolve) => {
    const r = cropRange(src.w, src.h, f);
    let crop = clampCrop({ cx: src.w / 2, cy: src.h / 2, cw: r.max }, src.w, src.h, f);
    let answered = false;
    const img = h('img.crop__img', { src: src.img.src, alt: '', draggable: 'false' });
    const view = h('div.crop__view.crop__view--' + f.key, { tabindex: '0', role: 'application', 'aria-label': 'Кадр: двигайте фото мышью или стрелками, масштаб — колесом или ползунком' },
      img, h('div.crop__grid', { 'aria-hidden': 'true' }),
      f.key === 'card' ? h('div.crop__zone', { 'aria-hidden': 'true' }, 'здесь на карточке будет текст') : null,
      f.key === 'avatar' ? h('div.crop__circle', { 'aria-hidden': 'true' }) : null);
    view.style.setProperty('--r', String(f.w / f.h));
    const zoom = h('input.crop__zoom', { type: 'range', min: '0', max: '100', step: '1', value: '0', 'aria-label': 'Масштаб' });
    const canZoom = r.max > r.min * 1.001;
    zoom.disabled = !canZoom;
    const info = h('small.muted');

    function paint() {
      const vw = view.clientWidth || 1, k = vw / crop.cw;
      img.style.width = src.w * k + 'px'; img.style.height = src.h * k + 'px';
      img.style.transform = `translate(${-(crop.cx - crop.cw / 2) * k}px, ${-(crop.cy - crop.ch / 2) * k}px)`;
      info.textContent = `Исходник ${src.w} × ${src.h} · в кадре ${Math.round(crop.cw)} × ${Math.round(crop.ch)} → сохранится ${f.w} × ${f.h}`;
    }
    function set(next) { crop = clampCrop({ ...crop, ...next }, src.w, src.h, f); if (canZoom) zoom.value = String(Math.round(100 * Math.log(r.max / crop.cw) / Math.log(r.max / r.min))); paint(); }
    const zoomBy = (factor) => set({ cw: crop.cw / factor });
    zoom.addEventListener('input', () => set({ cw: r.max * Math.pow(r.min / r.max, Number(zoom.value) / 100) }));

    // drag with one pointer, pinch with two
    const pts = new Map(); let pinch = 0;
    const dist = () => { const [a, b] = Array.from(pts.values()); return Math.hypot(a.x - b.x, a.y - b.y); };
    view.addEventListener('pointerdown', (e) => { try { view.setPointerCapture(e.pointerId); } catch (x) {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) pinch = dist(); view.classList.add('is-drag'); });
    view.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const k = crop.cw / (view.clientWidth || 1), dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) set({ cx: crop.cx - dx * k, cy: crop.cy - dy * k });
      else if (pts.size === 2 && pinch) { const d = dist(); if (d > 0) { zoomBy(d / pinch); pinch = d; } }
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) view.classList.remove('is-drag'); };
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
    view.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    view.addEventListener('keydown', (e) => {
      const s = crop.cw * 0.03, m = { ArrowLeft: { cx: crop.cx - s }, ArrowRight: { cx: crop.cx + s }, ArrowUp: { cy: crop.cy - s }, ArrowDown: { cy: crop.cy + s } }[e.key];
      if (m) { e.preventDefault(); set(m); } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.1); } else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.1); }
    });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null;
    if (ro) ro.observe(view);

    const finish = (v) => { if (answered) return; answered = true; if (ro) ro.disconnect(); resolve(v); };
    modal({
      title: (step ? `Кадр ${step.n} из ${step.of}: ` : '') + f.place,
      sub: `${f.ratio} · ${f.what}. Двигайте фото под рамкой, масштаб — ползунком.`,
      wide: true, onClose: () => finish(null),
      body: () => h('div.crop',
        h('div.crop__stage', view),
        h('div.crop__bar', h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Отдалить', disabled: !canZoom, onclick: () => zoomBy(1 / 1.15) }, '−'), zoom,
          h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Приблизить', disabled: !canZoom, onclick: () => zoomBy(1.15) }, '+')),
        info, canZoom ? null : h('small.muted', 'Фото ровно минимального размера — приблизить нельзя, иначе кадр станет мутным.')),
      actions: [
        { label: 'Отмена', onClick: () => finish(null) },
        { label: step && step.n < step.of ? 'Дальше' : 'Готово', kind: 'primary', onClick: async () => { try { finish(await renderCrop(src, crop, f)); } catch (e) { finish(null); throw e; } } },
      ],
    });
    requestAnimationFrame(paint);
    setTimeout(() => { paint(); view.focus(); }, 80);
  });
}

/**
 * The whole way for one file and one or several frames (a tour needs two frames of one photo).
 * Returns { files: { [frame.key]: File }, skipped: [frame…], src } — `skipped` are the frames the
 * photo is too small for; or null when the person cancelled. Throws an Error with a readable
 * text when the file is not a photo or fits none of the frames.
 */
export async function cropFile(file, frames) {
  const src = await readImage(file);
  try {
    const ok = frames.filter((f) => fits(src.w, src.h, f)), skipped = frames.filter((f) => !ok.includes(f));
    if (!ok.length) throw new Error(tooSmallText(src.w, src.h, frames));
    const files = {};
    for (let i = 0; i < ok.length; i++) {
      const out = await cropDialog(src, ok[i], { step: ok.length > 1 ? { n: i + 1, of: ok.length } : null });
      if (!out) return null;
      files[ok[i].key] = out;
    }
    return { files, skipped, w: src.w, h: src.h };
  } finally { src.release(); }
}
