# js/vendor — чужие библиотеки, которые сайт отдаёт сам

Страницы ничего не грузят с `cdn.jsdelivr.net`: библиотека лежит здесь, в репозитории, и
в `script-src` трёх страниц (`index.html`, `cabinet.html`, `admin.html`) этого CDN нет.
Раньше подключалась «плавающая» версия `@supabase/supabase-js@2` без контрольной суммы —
любое обновление или взлом CDN сразу попадали бы на сайт, в кабинет и в панель
(AUDIT.md, S4).

| Файл | Пакет npm | Версия | Что это |
|---|---|---|---|
| `supabase-js-2.117.2.js` | `@supabase/supabase-js` | **2.117.2** (вышла 25.09.2026) | `dist/umd/supabase.js` из пакета, без изменений; создаёт `window.supabase` |
| `supabase-js.LICENSE` | тот же | — | лицензия MIT из пакета |

Контрольные суммы:

```
архив пакета (npm, dist.integrity):
  sha512-eSG2VKnHR+Clp1PmidZ1/weJ8PJwoybjva3L2GgKqFG4YDS1Iqmc61psKGZP5xw6OMT2O7ZorPR42PY6q1BOXg==
файл supabase-js-2.117.2.js:
  sha256  59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd
  sha384  Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok   (base64, для атрибута integrity)
```

Ту же сумму sha256 знает `build.mjs`: сборка останавливается, если файл не совпадает,
если страница его не подключает или снова ссылается на CDN.

## Как получен файл

```
npm pack @supabase/supabase-js@2.117.2 --ignore-scripts
tar -xzf supabase-supabase-js-2.117.2.tgz
cp package/dist/umd/supabase.js js/vendor/supabase-js-2.117.2.js
shasum -a 256 js/vendor/supabase-js-2.117.2.js
```

Сумма архива сверена с `npm view @supabase/supabase-js@2.117.2 dist.integrity`.
Версия 2.117.3 на день работы (08.10.2026) существовала один день — взята предыдущая,
пролежавшая в реестре две недели.

## Как обновить

1. Повторить команды выше с новой версией; взять версию, которой не меньше двух недель.
2. Положить файл с версией в имени, старый удалить.
3. Поправить: таблицу и суммы здесь, `VENDOR` в `build.mjs`, тег `<script>` в трёх
   страницах.
4. Открыть сайт, кабинет и панель (`admin.html?demo` и живую) — без ошибок в консоли.

`qrcode.min.js` по-прежнему берётся с `cdnjs.cloudflare.com` — у его тега есть
`integrity`, подменённый файл браузер не выполнит. Он нужен сайту (QR чек-листа) и
панели (QR кампании); в кабинете его нет.
