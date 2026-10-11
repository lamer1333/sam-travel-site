# Выкладка сайта

Сайт статический. На хостинг уходит только папка `dist/`, её собирает `node build.mjs`
(список публикуемых файлов — в начале `build.mjs`). Служебное — `supabase/`, инструкции,
тесты — в `dist/` не попадает.

## Боевой сайт

Адрес: <https://samtravel-dny.pages.dev> — проект `samtravel` в аккаунте Cloudflare
заказчика (`samvelharutyunyan708@gmail.com`). Своего домена пока нет; что сделать, когда
он появится, — в разделе «Подключение своего домена» ниже.

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
обновляется — его проект нужно удалить, чтобы заказчик не попал на устаревшую версию.

## Заголовки и страница 404

Заголовки безопасности и кеширование — в `_headers` (запрет встраивания в рамку, HSTS,
`noindex` для панели и кабинета — и для адресов `/admin`, `/cabinet` без `.html`, которыми
Cloudflare отдаёт те же страницы). Cloudflare Pages их отправляет; проверено на боевом
адресе 11.10.2026 (AUDIT.md, S6).

Несуществующий адрес отдаёт `404.html` с кодом 404 — Cloudflare Pages берёт этот файл из
корня сам. Пока файла не было, любой адрес отвечал главной страницей с кодом 200. Пути в
`404.html` — от корня (`/js/…`), потому что страницу показывают на любой глубине.

## Подключение своего домена

По порядку; пункты 1, 3–5 делает владелец аккаунтов, пункт 2 — правка в репозитории.

1. **Домен и Cloudflare.** Состояние на 11.10.2026: `samtravel.am` зарегистрирован в
   name.am (до 15.06.2027) и направлен на серверы `hope.ns.cloudflare.com` и
   `terin.ns.cloudflare.com`, но зоны на них нет (ответ `REFUSED`), а в реестре осталась
   запись DS от прежней зоны — поэтому домен не открывается нигде.
   - В аккаунте Cloudflare заказчика: Add a domain → `samtravel.am`, тариф Free.
     Cloudflare назовёт два своих сервера имён.
   - В name.am: поставить эти два сервера имён (если отличаются от нынешних) и удалить
     запись DS (DNSSEC). Пока старая DS на месте, домен не заработает.
   - Когда зона станет Active: Workers & Pages → `samtravel` → Custom domains → добавить
     `samtravel.am` и `www.samtravel.am`. Записи и сертификат Cloudflare создаст сам.
   - Проверка: `dig +short samtravel.am` отдаёт адреса, `curl -I https://samtravel.am/`
     отвечает 200. DNSSEC можно включить заново уже в Cloudflare и внести новую DS в name.am.
2. **Адрес в коде.** Заменить `samtravel-dny.pages.dev` на домен в `index.html`,
   `sitemap.xml`, `robots.txt`, `js/admin/views/campaigns.js`, `js/admin/views/seo.js`,
   `supabase/functions/lead-mail/index.ts` и в секрете `SITE_URL` функции `lead-mail`.
   Затем `npm run deploy:prod`.
3. **Supabase** → Authentication → URL Configuration: Site URL — новый адрес, в Redirect
   URLs добавить `https://samtravel.am/**`. Без этого после входа человека вернёт на
   `pages.dev`.
4. **Google Cloud** → Clients: домен в Authorized JavaScript origins; Branding: домен в
   Authorized domains и ссылки на сайт. Приложение должно быть опубликовано (Audience →
   Publish app), иначе войдут только тестовые адреса.
5. **Почта.** В Mailjet подтвердить домен (записи SPF и DKIM у регистратора) и завести
   отправителя на нём, например `info@samtravel.am`. Поменять отправителя в двух местах:
   секрет `MAIL_FROM` функции `lead-mail` и Supabase → Authentication → SMTP Settings.
   Проверка — панель → «Готовность сайта» → «Отправить пробное письмо».
6. **Перенаправление и поиск.** В Cloudflare правило Bulk Redirects с
   `samtravel-dny.pages.dev` на домен; домен добавить в Google Search Console и отправить
   `sitemap.xml`.

## GitHub

Сайт выкладывается с компьютера командой `npm run deploy:prod`; GitHub в выкладке не
участвует. В репозитории остался сценарий `.github/workflows/pages.yml` от первой
публикации на GitHub Pages: он сработает при пуше в `main`.
GitHub Pages `_headers` не читает, и страницы 404 там нет, поэтому публиковать сайт там не
нужно — перед первым пушем
сценарий удалить или отключить Pages в настройках репозитория.

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
