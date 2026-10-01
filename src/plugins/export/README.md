# parsinegar.export

افزونه اپلیکیشن پارسی‌نگار: خروجی HTML فارسی — رندر Markdown روی `pey.markdown.service` و اسمبل سند مستقل راست‌به‌چپ با تم.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/export-service.js` — پیاده‌سازی سرویس.
- `lib/persian-extensions.js` — افزونه‌های micromark پارس‌نشان.
- `lib/mark-extension.js` — اکستنشن محلی `==هایلایت==`.
- `lib/assemble-document.js` — اسمبل سند کامل با CSS سه تم.
- `tests/export.test.js` + `tests/export-service.test.js` + `tests/export-parity.test.js` — تست‌های افزونه.
- `docs/reference.md` — مرجع کامل خودکفا.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.markdown.service` — رندر fragment؛ همه متدها بدون آن صریح fail می‌شوند.
- **اختیاری:** هیچ‌کدام.

## همچنین ببینید

- `docs/reference.md` برای قرارداد کامل متد و خطاها.
- `pey.markdown` (رپوی جدا) برای پایپ‌لاین رندر و sanitize.
