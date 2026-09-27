# parsinegar.settings

افزونه اپلیکیشن پارسی‌نگار: ترجیحات اعتبارسنجی‌شده کاربر (پوسته، جهت سند، اندازه قلم ادیتور) روی `pey.storage.service` با پیش‌فرض‌ها.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/settings-service.js` — پیاده‌سازی سرویس با پیش‌فرض‌ها و اعتبارسنجی.
- `tests/settings.test.js` + `tests/settings-service.test.js` — تست‌های افزونه.
- `docs/reference.md` — مرجع کامل خودکفا.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — ماندگاری رکورد؛ همه متدها بدون آن صریح fail می‌شوند. از دست رفتن ران‌تایم به‌صورت خطای critical گزارش می‌شود.
- **اختیاری:** هیچ‌کدام.

## همچنین ببینید

- `docs/reference.md` برای قرارداد کامل سرویس و ایونت.
- `parsinegar.documents` برای الگوی افزونه هم‌خانواده storage-backed.
