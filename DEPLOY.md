# Выкладка сайта

Сайт статический. На хостинг уходит только папка `dist/`, её собирает `node build.mjs`
(список публикуемых файлов — в начале `build.mjs`). Служебное — `supabase/`, инструкции,
тесты — в `dist/` не попадает.

## Cloudflare Pages (рекомендуется)

1. Репозиторий — в приватный GitHub.
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → выбрать репозиторий.
3. Настройки сборки:
   - Framework preset: **None**
   - Build command: `node build.mjs`
   - Build output directory: `dist`
4. Deploy. Сайт появится на адресе вида `sam-travel.pages.dev`.
5. Custom domains → добавить `samtravel.am` и `www.samtravel.am`, прописать у регистратора
   DNS-записи, которые покажет Cloudflare. Сертификат выпустится сам.
6. Дальше каждый `git push` в `main` обновляет сайт за минуту.

Заголовки безопасности и кеширование — в `_headers` (запрет встраивания в рамку, HSTS,
`noindex` для панели и кабинета).

## После первой выкладки проверить

- `https://samtravel.am/` открывается, языки переключаются.
- Форма заявки: заявка появилась в `admin.html` → «Заявки».
- Вход (меню → Войти) и личный кабинет.
- `curl -I https://samtravel.am/` показывает `x-frame-options: DENY`.

В Supabase (Auth → URL Configuration) домен `samtravel.am` уже прописан. Если проверяете
на адресе `*.pages.dev`, добавьте его в Redirect URLs — иначе вход вернёт на боевой домен.

## Обновление сайта

```bash
git add -A
git commit -m "что изменили"
git push
```

Тексты, туры, отзывы, контакты и промо меняются в панели без выкладки.
