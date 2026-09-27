# مرجع parsinegar.settings

## هدف

افزونه اپلیکیشن پارسی‌نگار: ترجیحات اعتبارسنجی‌شده کاربر روی `pey.storage.service`. یک رکورد تکی `preferences` در کالکشن `settings` کل ست را نگه می‌دارد؛ خواننده‌ها همیشه آبجکت کامل mergeشده روی پیش‌فرض‌ها می‌گیرند.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/settings-service.js` — پیاده‌سازی سرویس.
- `tests/` — تست‌های افزونه آینه فایل‌های سورس.
- `docs/reference.md` — همین فایل.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — ماندگاری رکورد؛ همه متدها بدون آن صریح fail می‌شوند. اگر سرویس بعد از فعال‌سازی در ران‌تایم ناپدید شود، افزونه خطای critical گزارش می‌کند.
- **اختیاری:** هیچ‌کدام.

## API عمومی

**سرویس:** `parsinegar.settings.service`. تنظیمات `{ theme, direction, fontSize }`‌اند:

- `theme`: برابر `'light'` یا `'dark'` یا `'device'` (پیروی از سیستم‌عامل) یا `'sepia'`.
- `direction`: برابر `'auto'` یا `'rtl'` یا `'ltr'` — جهت مبنای سند ویرایش‌شده.
- `fontSize`: اندازه قلم صحیح ادیتور به پیکسل، `12` تا `24`.

پیش‌فرض‌ها `{ theme: 'device', direction: 'auto', fontSize: 16 }`‌اند.

### `getSettings()`

ترجیحات ذخیره‌شده mergeشده روی پیش‌فرض‌ها را می‌خواند؛ رکورد گمشده پیش‌فرض‌ها را برمی‌گرداند و مقادیر ذخیره‌شده نامعتبر هر فیلد fallback می‌گیرند.

```js
const settings = await service.getSettings();
// => { theme: 'device', direction: 'auto', fontSize: 16 }
```

### `saveSettings(patch)`

پچ را اعتبارسنجی می‌کند، روی تنظیمات جاری merge می‌کند، نتیجه را ذخیره می‌کند و `settings:changed` منتشر می‌کند. فیلدهای ناشناخته نادیده گرفته می‌شوند؛ فیلدهای شناخته‌شده با مقادیر نامعتبر با `SETTINGS_INVALID_VALUE` که فیلد را نام می‌برد reject می‌شوند و چیزی ذخیره یا منتشر نمی‌شود.

```js
const settings = await service.saveSettings({ theme: 'dark' });
// => { theme: 'dark', direction: 'auto', fontSize: 16 }
```

## ایونت‌ها

- `settings:changed` با `{ id: 'preferences' }` — بعد از ذخیره ترجیحات منتشر می‌شود. لیسنرها از مسیر `getSettings()` بازخوانی می‌کنند.

## خطاها

خطاهای مرزی از ساختار استاندارد استفاده می‌کنند (`code` و `message` و `source` و `type` و `timestamp` و `detail`):

- `SETTINGS_INVALID_VALUE` (operational) — فیلد شناخته‌شده پچ اعتبارسنجی را رد کرد؛ `detail.field` نامش می‌برد.
- `SETTINGS_STORAGE_UNAVAILABLE` (operational) — فراخوانی پیش از فعال‌سازی یا بعد از غیرفعال‌سازی.
- `REQUIRED_DEPENDENCY_LOST` (critical) — وقتی `pey.storage.service` در ران‌تایم ناپدید شود به Core گزارش می‌شود.
