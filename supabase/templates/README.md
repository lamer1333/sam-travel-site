# Шаблоны писем Supabase Auth

## confirm-signup.html — подтверждение почты при регистрации

Одно письмо на трёх языках: в нём и код из 6 цифр (`{{ .Token }}`), и ссылка
(`{{ .ConfirmationURL }}`). Язык берётся из `{{ .Data.lang }}` — его передаёт форма
регистрации (`js/app.js`, поле `lang` в метаданных); если языка нет — английский.

Куда вставить (делается на этапе 6, при настройке нового проекта):

1. Supabase → Authentication → Sign In / Providers → Email:
   - **Confirm email** — включить;
   - **Email OTP Length** — 6;
   - **Email OTP Expiration** — 3600 секунд (в письме написано «один час»).
2. Authentication → Emails → Templates → **Confirm signup**:
   - Subject: `{{ if eq .Data.lang "ru" }}Код подтверждения: {{ .Token }} — SAM TRAVEL{{ else if eq .Data.lang "hy" }}Հաստատման կոդ՝ {{ .Token }} — SAM TRAVEL{{ else }}Your confirmation code: {{ .Token }} — SAM TRAVEL{{ end }}`
   - Body: содержимое `confirm-signup.html` целиком.
3. Authentication → Rate Limits: повторная отправка письма на один адрес — не чаще
   раза в 60 секунд (значение по умолчанию; сайт показывает такой же отсчёт).
4. Authentication → URL Configuration → Redirect URLs: адрес `cabinet.html` боевого
   домена — на него ведёт ссылка из письма.

Письма идут через свой почтовый сервис (SMTP), а не через встроенную отправку
Supabase — см. ТЗ §4.9.
