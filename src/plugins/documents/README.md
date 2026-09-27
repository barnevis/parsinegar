# parsinegar.documents

افزونه اپلیکیشن پارسی‌نگار: مدیریت چندسند برای رکوردهای Markdown روی `pey.storage.service` با timestamp خودکار `updatedAt`.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/documents-service.js` — پیاده‌سازی سرویس.
- `tests/documents.test.js` + `tests/documents-service.test.js` — تست‌های افزونه.
- `docs/reference.md` — مرجع کامل خودکفا.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — ماندگاری رکورد؛ همه متدها بدون آن صریح fail می‌شوند.
- **اختیاری:** هیچ‌کدام.

## همچنین ببینید

مرجع کامل API/ایونت‌ها/خطاها/پیکربندی/قواعد-کسب‌وکار/قیدها در [`docs/reference.md`](docs/reference.md).
