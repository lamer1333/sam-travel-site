# Выкладка сайта

Сайт статический. На хостинг уходит только папка `dist/`, её собирает `node build.mjs`
(список публикуемых файлов — в начале `build.mjs`). Служебное — `supabase/`, инструкции,
тесты — в `dist/` не попадает.

## Боевой сайт

Адрес: <https://samtravel-dny.pages.dev> — проект `samtravel` в аккаунте Cloudflare
заказчика (`samvelharutyunyan708@gmail.com`). Своего домена пока нет; когда появится, он
добавляется в этом же проекте (Custom domains), а адрес в `index.html`, `sitemap.xml`,
`robots.txt`, `js/admin/views/campaigns.js`, `js/admin/views/seo.js` и в секрете `SITE_URL`
функции `lead-mail` меняется на него.

```bash
npm run deploy:prod
```

Команда прогоняет тесты, собирает `dist/` и выкладывает его; если тесты не прошли,
выкладки не будет. Нужен вход `npx wrangler login` в аккаунт заказчика. Рабочий порядок:
правка → `npm run deploy:prod` → проверка на сайте → коммит. Выкладка идёт с компьютера;
через GitHub сайт не выкладывается.

## Предпросмотр для заказчика

Временный адрес: <https://samtravel-preview.pages.dev> — проект `samtravel-preview` в
аккаунте Cloudflare компании (тот же, где `webspace-am` и `joygroup-preview`).

```bash
npm run deploy:preview
```

Команда собирает `dist/` и выкладывает его; номер аккаунта зашит в неё, поэтому она не
зависит от того, какой проект выкладывали последним. Нужен вход `npx wrangler login` в
аккаунт компании. Показывать заказчику: `/admin?demo` (панель на сгенерированных данных)
и `/?cms=demo` (сайт с демо-контентом). Чтобы на предпросмотре работал настоящий вход,
его адрес должен быть в Supabase → Authentication → URL Configuration → Redirect URLs.

Старый адрес `sam-travel-preview.pages.dev` лежит в другом аккаунте и больше не
обновляется.

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
`noindex` для панели и кабинета — и для адресов `/admin`, `/cabinet` без `.html`, которыми
Cloudflare отдаёт те же страницы).

### GitHub Pages `_headers` не читает

Сейчас сайт публикуется на GitHub Pages (`.github/workflows/pages.yml`). Там файл
`_headers` — обычный файл: **ни один заголовок из него не отправляется**. На GitHub Pages
работает только то, что задано в самих страницах: политика CSP в `<meta>` и
`<meta name="robots">` у панели и кабинета. Не работают: запрет встраивания сайта в чужую
рамку (`X-Frame-Options`, `frame-ancestors` — через `<meta>` их задать нельзя), HSTS,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, правила кеша.

Где сайт живёт дальше — решает заказчик на этапе 6 (TZ-STAGES.md). Если остаётся GitHub
Pages, заголовки можно получить, поставив перед сайтом Cloudflare (домен через его DNS
с проксированием и правила Transform Rules → Response Headers) — либо перейти на
Cloudflare Pages, как описано выше. До этого решения пункт остаётся открытым (AUDIT.md, S6).

## После первой выкладки проверить

- `https://samtravel-dny.pages.dev/` открывается, языки переключаются.
- WhatsApp: кнопка на карточке тура открывает чат с текстом про этот тур и номером обращения; номер находится в `admin.html` → «Продажи» → «Продажа».
- Вход (меню → Войти) и личный кабинет.
- `curl -I https://samtravel-dny.pages.dev/` показывает `x-frame-options: DENY`.

В Supabase (Auth → URL Configuration) Site URL — `https://samtravel-dny.pages.dev`, в
Redirect URLs — `https://samtravel-dny.pages.dev/**`. Адрес предпросмотра добавляется туда
же, иначе вход с него вернёт на боевой сайт.

## Обновление сайта

```bash
npm run deploy:prod
git add -A
git commit -m "что изменили"
```

Тексты, туры, отзывы, контакты и промо меняются в панели без выкладки.
