# pey.filesystem

افزونه زیرساختی Pey: دسترسی به فایل و پوشهٔ دستگاه کاربر — انتخاب فایل/پوشه، فهرست بازگشتی ورودی‌های Markdown، خواندن و نوشتن از مسیر handleهای File System Access (با پرچم قابلیت برای مسیرهای جایگزین).

> تنها `pey.*` محلی مخزن: انکوباتور افزونهٔ مستقل آیندهٔ اکوسیستم Pey است؛ روز استخراج فقط به رپوی جدا منتقل می‌شود، بدون rename (تصمیم ثبت‌شده در `docs/decisions.md`).

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی؛ بدون وابستگی).
- `lib/filesystem-service.js` — پیاده‌سازی سرویس (بدون DOM؛ pickerها تزریق می‌شوند؛ پیش‌نویس‌های سایه روی `pey.storage.service`).
- `tests/filesystem.test.js` + `tests/filesystem-service.test.js` — تست‌های افزونه با picker/handle/فایل/استورج فیک.
- `docs/reference.md` — مرجع کامل خودکفا.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — پیش‌نویس‌های سایه (انبار `disk-drafts`).
- **اختیاری:** هیچ‌کدام.

## همچنین ببینید

- `docs/reference.md` برای قرارداد کامل متد و خطاها.
