# مرجع `pey.sync`

## هدف

موتور همگام‌سازی دستی و backend-neutral برای مجموعه‌های `pey.storage.service` به فضای انتخابی کاربر (نسخه اول: مخزن گیت).

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/error.js` — خطای ساخت‌یافته (`syncError`).
- `lib/sync-engine.js` — منطق تصمیم خالص (diff، plan، مانیفست، هش).
- `lib/serializers.js` — کدک‌های `json` و `markdown` + قانون نام فایل.
- `lib/sync-service.js` — پیاده‌سازی سرویس.
- `adapters/git-adapter.js` — بک‌اند گیت روی GitHub Contents API.
- `adapters/README.md` — قرارداد kind تازه برای ذخیره‌سازهای بعدی.
- `tests/` — تست هر فایل سورس.
- `docs/requirements.md` — تنها منبع حقیقت پیاده‌سازی.
- `imp/` — طرح محلی؛ در گیت نیست.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — خواندن/نوشتن رکوردها و وضعیت/اعتبار موتور؛ همه متدها بدون آن صریح fail می‌شوند.
- **اختیاری:** هیچ‌کدام.

## API عمومی

قرارداد رسمی همان `manifest.json` است؛ اینجا فقط نحوه صدا زدن:

```js
// ۱. پیکربندی (اعتبارسنجی زنده، خروجی بدون secret)
await sync.configureBackend({
  kind: 'git',
  params: { repo: 'user/notes', branch: 'main', token: '<pat>' },
});
// → { ok: true, kind: 'git', repo: 'user/notes', branch: 'main' }

// ۲. اجرا با دامنه صریح
const report = await sync.syncNow({
  scope: { collections: [
    { collection: 'folders', serializer: 'json' },
    { collection: 'docs', serializer: 'markdown', titleField: 'title',
      folders: { collection: 'folders', nameField: 'name' } },
  ] },
});
// → { pushed, pulled, deletedRemote, deleteLocal, relocated, skipped,
//     conflicts: [{ collection, id, title, local, remote }], completed }

// ۳. resolve تکی (بازگرداندن باقیمانده)
await sync.resolveConflict({ collection: 'docs', id: 'd1', choice: 'local' });
// → { remaining: 0 } (در صفر، ساعت جلو می‌رود)

// ۴. وضعیت و حذف
await sync.getStatus();
// → { configured, kind, repo, branch, lastSyncAt, lastError }
await sync.removeBackend(); // → { ok: true } (داده محلی دست نمی‌خورد)

// ۵. پیش‌پرواز محلی (بدون هیچ شبکه‌ای)
await sync.hasPendingChanges({ scope });
// → { pending: true/false } (فقط خبر محلی نسبت به عکس آخر؛
// پیکربندی‌نشده همیشه false است، نه خطا)
```

نکته‌ها: `syncNow` اول draft معلق را نمی‌شناسد — میزبان قبلش flush کند. `resolveConflict` دامنه را از اجرای قبلی می‌خواند (نیازی به scope دوباره نیست). `title` مانیفست فقط فراداده وفاداری نام‌هاست. `hasPendingChanges` همان مقایسه مهری `syncNow` است بدون شبکه: «ارسال‌نشده محلی» را می‌فهمد ولی عقب‌ماندگی از ریموت را نه — نقطه «کثیف» ادعای بیشتری ندارد.

## ایونت‌ها

- `sync:changed` — پس از هر اجرا (موفق یا ناتمام): `{ pushed, pulled, conflicts }` (آیتم‌ها `{ collection, id }`؛ جزئیات کامل فقط در مقدار برگشتی `syncNow` است).
- `sync:conflicts` — هنگام توقف روی تعارض: `{ conflicts: [{ collection, id }] }`.

## مرجع خطاها (همه operational)

| کد | کی |
|---|---|
| `SYNC_NOT_CONFIGURED` | فراخوانی sync/resolve بدون بک‌اند |
| `SYNC_INVALID_CONFIG` | kind ناشناس، اسکوپ بد، choice بد، تعارض ناموجود |
| `SYNC_AUTH_FAILED` | رد توکن (۴۰۱) یا دسترسی ناکافی (۴۰۳: مخزن انتخاب نشده یا مجوز Contents کم است) |
| `SYNC_REPO_NOT_FOUND` | نبود مخزن/شاخه |
| `SYNC_NETWORK_FAILED` | قطع شبکه، خطای HTTP متفرقه یا تمام‌شدن مهلت ۳۰ ثانیه‌ای درخواست |
| `SYNC_RATE_LIMITED` | سقف نرخ (۴۰۳ + هدر) |
| `SYNC_CORRUPT_MANIFEST` | مانیفست ریموت خوانا نیست |
| `SYNC_CONCURRENT_CHANGE` | نوشتن مانیفست روی rev کهنه (اجرای بعدی با خوانش تازه) |
| `SYNC_STORAGE_UNAVAILABLE` | استوریج محلی در دسترس نیست |


## پیکربندی

پلاگین هیچ کلید bootstrap لازم ندارد جز انتخاب آداپتر (`adapters: {sync-target}` — مقدار پیش‌فرض kind است؛ kind واقعی هر اجرا با `configureBackend` می‌آید). اسکیمای استورها (`sync_backends`، `sync_state` با `keyPath: id`) از کانفیگ `pey.storage` در `bootstrap.json` می‌آید (schemaVersion ۵).

## قواعد کسب‌وکار

- منبع حقیقت همیشه محلی است؛ مقصد آینه است.
- ترتیب اجرا: ارسال، دریافت، تشخیص تعارض؛ snapshot فقط با تکمیل تمیز جلو می‌رود.
- تعارض (هر دو سو عوض‌شده + هش فرق، یا حذف-دربرابر-تغییر) همیشه می‌ایستد و پرامپ می‌خواهد.
- محتوای یکسان با هش برابر هرگز بازنویسی نمی‌شود.
- تغییرنام = push به مسیر تازه + حذف مسیر قبلی؛ رکورد بی‌شناسه رد می‌شود.
- آخرین-نوشته در سطح فایلِ تنها معیار نیست — درستی با مانیفست است.

## محدودیت‌ها

- ماشه فقط دستی است (`syncNow`)؛ زمان‌بندی خودکار با میزبان است.
- هر درخواست شبکه سقف ۳۰ ثانیه دارد؛ سرور بی‌پاسخ خطای شبکه می‌دهد، نه انتظار بی‌پایان.
- متن UTF-8؛ باینری خارج اسکوپ نسخه اول.
- توکن در IndexedDB خواناست — محافظ فقط قفل پروفایل سیستم‌عامل است (افشا در راهنما).
- هم‌زمانی دو دستگاه در یک ثانیه، `SYNC_CONCURRENT_CHANGE` می‌دهد: دوباره اجرا کنید.
- ساعت کج دستگاه‌ها پذیرفته است (پوشش: هش + پرامپ).
