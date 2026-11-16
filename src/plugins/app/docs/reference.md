# مرجع parsinegar.app

## هدف

افزونه اپلیکیشن پارسی‌نگار: مالک کاتالوگ مسیرهای نسخه ۱ (ثبت در Router موقع activation) و مالک عملیات سطح اپ که از مرز همهٔ پلاگین‌ها عبور می‌کنند — امروز «پاک کردن کل داده‌ها».

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان.
- `lib/app-service.js` — سرویس `parsinegar.app.service`.
- `lib/error.js` — قالب‌های خطای ساخت‌یافته استاندارد.
- `tests/app.test.js` — تست‌های افزونه.
- `docs/reference.md` — همین فایل.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.router.service` — ثبت مسیر و استیت ناوبری؛ افزونه بدون آن کارکردی ندارد.
- **لازم:** `pey.storage.service` — پاک‌سازی داده‌ها از مسیر سرویس ذخیره‌ساز می‌گذرد (هرگز مستقیم به adapter).
- **اختیاری:** هیچ‌کدام.

## API عمومی

سرویس `parsinegar.app.service`:

### `wipeAllData()`

همهٔ رکوردهای همهٔ storeهای اعلام‌شده در bootstrap را در **یک تراکنش اتمیک بین‌مجموعه‌ای** پاک می‌کند: برای هر مجموعه `query(collection, {})` می‌خواند و کلیدها را (با فیلد keyPath خودِ store — `disk-drafts` روی `key`، بقیه روی `id`) به‌صورت عملیات delete در یک `transaction` می‌فرستد. اگر هیچ رکوردی نباشد، transaction صدا زده نمی‌شود.

```javascript
const outcome = await service.wipeAllData();
// { ok: true, cleared: { documents: 2, folders: 1, settings: 1, 'disk-drafts': 0, sync_backends: 1, sync_state: 1 } }
```

- ایونتی منتشر نمی‌کند: تنها مصرف‌کننده جریان UI است که بلافاصله صفحه را ری‌لود می‌کند؛ رویدادهای نیمه‌حذف بی‌معنا هستند.
- تراکنش اتمیک است: شکست یعنی هیچ storeای عوض نشده.

## ایونت‌ها

هیچ ایونتی منتشر نمی‌کند. به `core:service-unavailable` گوش می‌دهد (فقط برای وابستگی لازم `pey.storage.service`): گم‌شدنش بعد از فعال‌سازی، خطای بحرانی با کد `REQUIRED_DEPENDENCY_LOST` گزارش می‌شود.

## مرجع خطاها

| کد | نوع | معنا |
|---|---|---|
| `APP_STORAGE_UNAVAILABLE` | operational | سرویس فراخوانی قبل از bind شدن storage یا خطای سرویس ذخیره‌ساز در طول wipe. |
| `APP_STORAGE_UNAVAILABLE` | startup | `pey.storage.service` در سرویس‌های bindشدهِ activation نیست. |
| `REQUIRED_DEPENDENCY_LOST` | critical | وابستگی لازم بعد از فعال‌سازی از دست رفته. |

خطاها شیء ساده با `code`/`message`/`source`/`type`/`timestamp`/`detail` (قرارداد خانواده Pey)؛ هیچ داده حساسی در `message`/`detail` نمی‌رود.

## پیکربندی

هیچ کلید پیکربندی. `config` مانیفست `{}` است و `prepare` پیکربندی کانتکستش را نادیده می‌گیرد.

## قواعد کسب‌وکار

- کاتالوگ مسیر نسخه ۱ دقیقاً `'/'` (ادیتور) و `'/not-found'` (اسلات جایگزین) است. افزودن صفحه یعنی افزودن الگویش اینجا.
- ثبت مسیر در `activate` اتفاق می‌افتد، هرگز در `prepare`: قرارداد Router اجازه `registerRoutes` را فقط موقع فعال‌سازی محلی صدازننده، بعد از binding، می‌دهد.
- ثبت برای این الگوها افزایشی و idempotent است؛ ثبت دوباره همان الگوها چیزی عوض نمی‌کند.
- هدف‌های wipe باید دقیقاً با storesهای اعلام‌شدهٔ bootstrap یکی باشند — تست پلاگین (`should_declare_exactly_the_bootstrapped_stores_as_wipe_targets`) دو فهرست را با هم پین می‌کند؛ store تازه در bootstrap بدون ورود به `DATA_COLLECTIONS` از پاک‌سازی جا می‌ماند.
- پاک‌سازی همیشه یک transaction است، هرگز حلقهٔ delete تکی: همهٔ storeها با هم محو می‌شوند یا هیچ‌کدام.

## قیدها

- مسیرها را در `prepare` ثبت نکن — در آن فاز هیچ مرجع سرویسی نیست و Router ردش می‌کند.
- بدون به‌روزرسانی اول مانیفست، سرویس ارائه‌شده اینجا اضافه نکن؛ مانیفست قرارداد معتبر است.
- الگوهای ثبت‌شده اینجا باید با کاتالوگ page-loader در `src/ui/index.js` همگام بمانند: هر الگوی مالک به ورودی `{ pattern, load, element }` متناظر نیاز دارد، وگرنه روتر مسیری را resolve می‌کند که UI نمی‌تواند سوار کند.
- به adapter ذخیره‌ساز مستقیم دست نزن — فقط از مسیر `pey.storage.service` (قانون پلاگین product).
