# parsinegar.app

افزونه اپلیکیشن پارسی‌نگار: مالک کاتالوگ مسیرهای نسخه ۱ (ثبت در Router موقع activation) و مالک عملیات سطح اپ که از مرز پلاگین‌های دیگر عبور می‌کنند — سرویس `parsinegar.app.service` با `wipeAllData()` همهٔ storeهای اعلام‌شدهٔ bootstrap را در یک تراکنش اتمیک پاک می‌کند.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان.
- `lib/app-service.js` — سرویس `parsinegar.app.service`.
- `lib/error.js` — قالب‌های خطای ساخت‌یافته استاندارد.
- `tests/app.test.js` — تست‌های افزونه.
- `docs/reference.md` — مرجع کامل خودکفا.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.router.service` — ثبت مسیر و استیت ناوبری؛ افزونه بدون آن کارکردی ندارد.
- **لازم:** `pey.storage.service` — پاک‌سازی داده‌ها از مسیر سرویس ذخیره‌ساز می‌گذرد.
- **اختیاری:** هیچ‌کدام.

## همچنین ببینید

مرجع کامل API/ایونت‌ها/خطاها/پیکربندی/قواعد-کسب‌وکار/قیدها در [`docs/reference.md`](docs/reference.md).
