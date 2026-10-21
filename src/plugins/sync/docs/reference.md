# مرجع `pey.sync`

## هدف

موتور همگام‌سازی دستی و backend-neutral برای مجموعه‌های `pey.storage.service` به فضای انتخابی کاربر (بک‌اند‌های همراه: GitHub و GitLab « شامل سرور خودمیزبان با آدرس پایه دلخواه).

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/error.js` — خطاهای ساخت‌یافته (`syncError`، `syncStartupError`، `syncCriticalError`).
- `lib/sync-engine.js` — منطق تصمیم خالص (diff، plan مسیرمحور، هش، مچ ignore).
- `lib/serializers.js` — کدک‌های `json` و `markdown` + قانون نام فایل.
- `lib/sync-scope.js` — اعتبارسنجی دامنه، انتساب مسیر (basePath/اتریبیوشن) و شکل‌دهی رکورد.
- `lib/sync-paths.js` — نگاشت پوشه‌ها، ساخت مسیر ریموت و بازسازی زنجیره پوشه هنگام pull.
- `lib/sync-collect.js` — فهرست محلی و فیلتر ignore.
- `lib/sync-remote.js` — فهرست زنده مخزن (انتساب مسیر)، هش فایل ریموت، ساخت رکورد pullشده و پاک‌سازی میراث ۰.۲.۰.
- `lib/sync-round.js` — یک دور اجرا (plan/apply/finalize) و شمارش تعارض باقی‌مانده.
- `lib/sync-backend.js` — رجیستری kindها و نگاشت خطای آداپتر.
- `lib/sync-state.js` — نگه‌داری محلی (گاردها، خطاها، اسکوپ، مهاجرت و پیشبرد عکس نسخه ۲).
- `lib/sync-store.js` — نگهبان قطع استوریج.
- `lib/sync-service.js` — شش متد سرویس (مونتاژ لاغر روی ماژول‌ها).
- `adapters/git-adapter.js` — بک‌اند گیت روی GitHub Contents API.
- `adapters/gitlab-adapter.js` — بک‌اند گیت‌لب روی GitLab Files API (گیت‌لب.کام و خودمیزبان با `baseUrl`)؛ rev = blob sha و قفل روی `last_commit_id` پس از راستی‌آزمایی GET.
- `adapters/shared.js` — مهلت ۳۰ ثانیه، کدک base64 و پیام کامیت مشترک بک‌اند‌های گیت.
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
// → { ok: true, kind: 'git', repo: 'user/notes', branch: 'main', baseUrl: null }

// ۱الف. گیت‌لب: baseUrl اختیاری برای سرور خودمیزبان (ریشهٔ میزبان،
// مثل https://gitlab.example.com)؛ خالی/ناموجود = گیت‌لب.کام.
await sync.configureBackend({
  kind: 'gitlab',
  params: { repo: 'user/notes', branch: 'main', token: '<pat>',
            baseUrl: 'https://gitlab.example.com' },
});
// → { ok: true, kind: 'gitlab', ..., baseUrl: 'https://gitlab.example.com' }

// ۲. اجرا با دامنه صریح (هویت مسیر: مخزن فقط اسناد واقعی را می‌بیند)
const report = await sync.syncNow({
  message: 'پيام کامیت سفارشی', // اختیاری (۰.۴.۰): پیام عیناً همهٔ
  // نوشته‌ها/حذف‌های همین دور می‌شود (تریم، بیشینه ۲۰۰ نویسه)؛
  // نبود/خالی = پیام‌های خودکارِ پیش‌فرض. حل تعارض و پاک‌سازی میراث
  // همیشه پیام خودکار می‌گیرند.
  scope: { collections: [
    { collection: 'projects', serializer: 'json' }, // → projects/<id>.json
    { collection: 'tasks', serializer: 'markdown', titleField: 'name',
      contentField: 'body', folders: { collection: 'projects', nameField: 'name' },
      ignore: ['scratch'] }, // → ریشه مخزن (basePath پیش‌فرض '')
  ] },
});
// → { pushed, pulled, deletedRemote, deleteLocal, relocated, skipped,
//     conflicts: [{ collection, id, title, local, remote }], completed }

// ۳. resolve تکی (بازگرداندن باقیمانده)
await sync.resolveConflict({ collection: 'tasks', id: 't1', choice: 'local' });
// → { remaining: 0 } (در صفر، ساعت جلو می‌رود)

// ۴. وضعیت و حذف
await sync.getStatus();
// → { configured, kind, repo, branch, baseUrl, lastSyncAt, lastError }
await sync.removeBackend(); // → { ok: true } (داده محلی دست نمی‌خورد)

// ۵. پیش‌پرواز محلی (بدون هیچ شبکه‌ای)
await sync.hasPendingChanges({ scope });
// → { pending: true/false } (فقط خبر محلی نسبت به عکس آخر؛
// پیکربندی‌نشده همیشه false است، نه خطا)
```

نکته‌ها: موتور رکوردهای در حال ویرایش میزبان را نمی‌شناسد — میزبان قبل از اجرا ذخیره معلق را flush کند. `resolveConflict` دامنه را از اجرای قبلی می‌خواند (نیازی به scope دوباره نیست). سمت ریموتِ تعارض فقط محتواست (گیت مهر زمانی نمی‌دهد). `hasPendingChanges` همان مقایسه هشی `syncNow` است بدون شبکه: «خبر محلی» را می‌فهمد ولی عقب‌ماندگی از ریموت را نه.

## دامنه (فیلدهای هر کالکشن)

- `collection` (الزامی): نام کالکشن استوریج.
- `serializer`: ‏`json` (پیش‌فرض) یا `markdown`.
- `basePath`: ریشه مسیر ریموت این کالکشن (پیش‌فرض: json → نام خود کالکشن، متن → ریشه مخزن؛ `''` صریح برای ریشه مجاز است).
- `idField` (پیش‌فرض `id`)، `updatedAtField` (پیش‌فرض `updatedAt`)، `titleField` (پیش‌فرض `title`)، `contentField` (پیش‌فرض `content`): نام فیلدهای رکورد میزبان — میزبانی با شکل دیگر، همین‌جا نگاشت می‌کند.
- `folders`: ‏`{ collection, nameField, idField?, parentField?, folderField? }` برای مسیرسازی از زنجیره نام‌ها؛ رکورد پوشه هرگز به remote نمی‌رود و زنجیره گم‌شده هنگام pull از مسیر بازسازی می‌شود.
- `ignore`: آرایه الگوهای gitignore-گونه (پیش‌فرض `[]`).
- پسوند فایل از سریالایزر می‌آید (`md`/`json`) و مچ الگوها همان پسوندها را نادیده می‌گیرد؛ `title` خالی به `untitled` می‌افتد؛ عنوان pullشده از نام فایل می‌آید.

## ثبت بک‌اند تازه

موتور kindای که دیسکریپتورش ثبت نشده باشد را با `SYNC_INVALID_CONFIG` رد می‌کند. دیسکریپتور (`kind`، `create(params, fetchFn)`، `errorMap`، `revMismatchCode` اختیاری) در `adapters/README.md` تعریف شده؛ میزبان آن را روی `adapters` استیت سرویس می‌دهد و هسته نیازی به ویرایش ندارد (`git` پیش‌فرضِ همراه است). دیسکریپتور دیگر `manifestPath` ندارد — بک‌اند هیچ metadata ای روی مخزن نمی‌نویسد و کامل فایل‌محور است.

## نادیده گرفتن (gitignore-گونه)

هر کالکشن در دامنه می‌تواند `ignore: [...]` بگیرد (آرایه رشته‌های ناخالی، وگرنه `SYNC_INVALID_CONFIG`):

```js
await sync.syncNow({
  scope: { collections: [
    { collection: 'docs', serializer: 'markdown', ignore: ['پیش‌نویس', 'آرشیو/'] },
  ] },
});
```

- الگو روی مسیر همگام‌شده مچ می‌شود **بدون پسوند** (میزبان از کاربر پسوند نمی‌خواهد): `*` و `?` درون یک سگمنت، `**` میان سگمنت‌ها، الگوی بی‌اسلش روی هر سگمنت در هر عمق، `/` پایانی یعنی پوشه و کل زیردرختش. `!` (نفی) ندارد و عمداً لیترال است؛ حساس به حروف مثل میزبان. پسوند تایپ‌شده هم از مسیر کامل fallback می‌خورد تا بی‌صدا از دست نرود.
- رکورد نادیده از محلی، فهرست مخزن و عکس آخر هر سه کنار می‌رود (در گزارش `skipped` با همان شکل، مسیرهای خارج انتساب هم `foreign` سوی همان گزارش) — پوشه با مسیر نمایشی (`آموزش/زیر`) قضاوت می‌شود تا نادیده گرفتن پوشه خود پوشه را هم ببرد، نه فقط محتوایش را. ورودی نادیده‌شده در عکس آخر `deleteLocal` نمی‌شود: رکورد از صلاحیت موتور خارج شده، حذف کذب نمی‌گیرد.
- تغییرنام/جابه‌جایی می‌تواند رکورد را از زیر الگوی دقیق بیرون بکشد (مثل خود gitignore)؛ الگوی کلی (`پیش*`) از این مصون‌تر است.

## ایونت‌ها

- `sync:changed` — پس از هر اجرا (موفق یا ناتمام): `{ pushed, pulled, conflicts }` (آیتم‌ها `{ collection, id }`؛ جزئیات کامل فقط در مقدار برگشتی `syncNow` است).
- `sync:conflicts` — هنگام توقف روی تعارض: `{ conflicts: [{ collection, id }] }`.

## مرجع خطاها (همه operational)

خطاها آبجکت ساده‌اند (`code`/`message`/`source`/`type`/`timestamp`/`detail`، مثل خانواده Pey) نه نمونه `Error`؛ `detail` پیش‌فرض `null` است و کد آداپتر در `detail.adapterCode` می‌ماند.

| کد | کی |
|---|---|
| `SYNC_NOT_CONFIGURED` | فراخوانی sync/resolve بدون بک‌اند |
| `SYNC_INVALID_CONFIG` | kind ناشناس، آدرس پایه بد گیت‌لب (غیر http(s))، اسکوپ بد، choice بد، تعارض ناموجود |
| `SYNC_AUTH_FAILED` | رد توکن (۴۰۱) یا دسترسی ناکافی (۴۰۳: گیت‌هاب — مخزن انتخاب نشده یا مجوز Contents کم؛ گیت‌لب — توکن پروژه/مخزن دیگری یا فاقد اسکوپ) |
| `SYNC_REPO_NOT_FOUND` | نبود مخزن/شاخه (گیت‌لب: نبود پروژه با مسیر owner/name یا شاخه آن) |
| `SYNC_NETWORK_FAILED` | قطع شبکه، خطای HTTP متفرقه یا تمام‌شدن مهلت ۳۰ ثانیه‌ای درخواست |
| `SYNC_RATE_LIMITED` | سقف نرخ (۴۰۳ + هدر) |
| `SYNC_PATH_COLLISION` | دو رکورد محلی یک مسیر ریموت را ادعا می‌کنند (با هر دو شناسه، پیش از هر نوشتن ریموت) |
| `SYNC_CONCURRENT_CHANGE` | نوشتن/حذف فایل روی rev کهنه (اجرای بعدی با خوانش تازه) |
| `SYNC_STORAGE_UNAVAILABLE` | استوریج محلی در دسترس نیست |


## پیکربندی

پلاگین هیچ کلید bootstrap لازم ندارد جز انتخاب آداپتر (`adapters: {sync-target}` — مقدار پیش‌فرض kind است؛ kind واقعی هر اجرا با `configureBackend` می‌آید). اسکیمای استورها (`sync_backends`، `sync_state` با `keyPath: id`) از کانفیگ `pey.storage` در `bootstrap.json` می‌آید (schemaVersion ۵).

## قواعد کسب‌وکار

- منبع حقیقت همیشه محلی است؛ مقصد آینه است.
- **هویت همگام‌سازی خودِ مسیر ریموت است**: هیچ فایل metadata ای روی مخزن نمی‌نویسد (`sync-manifest.json` روایت ۰.۲.۰ بود و پاک می‌شود). شناسه سیمکش در `sync_state` (عکس نسخه ۲، مسیرکلیدی با `{collection,id,path,hash,rev}`) نگه داشته می‌شود و مخزن فقط فایل‌های واقعی را می‌بیند.
- ترتیب اجرا: فهرست زنده مخزن (+ مهاجرت عکس) → میانبر rev (مسیرهای rev-برابر هش قدیمی می‌مانند و خوانده نمی‌شوند) → ارسال، دریافت، حذف دوطرفه، تشخیص تعارض؛ snapshot فقط با تکمیل تمیز جلو می‌رود.
- مقایسه تغییر با هش محتواست (بدون مهر فرار)، نه ساعت؛ تعارض = هر دو سو پا با هش غیر یکی، یا حذف-دربرابر-تغییر — و همیشه می‌ایستد و پرامپ می‌خواهد (هیچ‌سو خاموش نمی‌برد).
- محتوای یکسان با هش برابر هرگز بازنویسی نمی‌شود؛ برابری بی‌پایه (مهاجرت بی‌هش) هم در صورت برابری محتوا بی‌پرسش منعقد می‌شود.
- تغییرنام = push به مسیر تازه + حذف مسیر قبلی؛ دو سند محلی به یک مسیر `SYNC_PATH_COLLISION` می‌دهد؛ رکورد بی‌شناسه رد می‌شود.
- کالکشن json با هویت مسیرشده (`<base>/<id>.json`)؛ کالکشن متنی عنوان و پوشه را از مسیر می‌گیرد.
- روی گیت‌لب، rev = blob sha است (tree و پاسخ نوشتن `last_commit_id` را نمی‌دهند)؛ نوشته/حذفِ فایلِ دیده‌شده پیش از تغییر یک GET راستی‌آزمایی می‌کند (تباهی یا نبود blob = تعارض، همان GitLab 400 عمومی که به `SYNC_CONCURRENT_CHANGE` نقشه می‌خورد) و پس از نوشتن سکه با یک GET تعقیبی blob تازه برمی‌گردد.

## محدودیت‌ها

- ماشه فقط دستی است (`syncNow`)؛ زمان‌بندی خودکار با میزبان است.
- هر درخواست شبکه سقف ۳۰ ثانیه دارد؛ سرور بی‌پاسخ خطای شبکه می‌دهد، نه انتظار بی‌پایان.
- متن UTF-8؛ باینری خارج اسکوپ نسخه اول.
- توکن در IndexedDB خواناست — محافظ فقط قفل پروفایل سیستم‌عامل است (افشا در راهنما).
- هم‌زمانی دو دستگاه در یک ثانیه، `SYNC_CONCURRENT_CHANGE` می‌دهد: دوباره اجرا کنید.
- ساعت کج دستگاه‌ها پذیرفته است (پوشش: هش + پرامپ).
