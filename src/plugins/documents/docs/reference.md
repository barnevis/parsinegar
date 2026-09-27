# مرجع parsinegar.documents

## هدف

افزونه اپلیکیشن پارسی‌نگار: مدیریت چندسند برای رکوردهای Markdown روی `pey.storage.service` با timestamp خودکار `updatedAt`.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/documents-service.js` — پیاده‌سازی سرویس.
- `tests/` — تست‌های افزونه آینه فایل‌های سورس.
- `docs/reference.md` — همین فایل.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — ماندگاری رکورد؛ همه متدها بدون آن صریح fail می‌شوند.
- **اختیاری:** هیچ‌کدام.

## API عمومی

**سرویس:** `parsinegar.documents.service`. رکوردها `{ id, title, content, createdAt, updatedAt, readOnly }`‌اند که در کالکشن `documents` ذخیره می‌شوند (`readOnly` برای رکوردهای پیش از خودش پیش‌فرض `false` می‌گیرد).

### `listDocuments()`

همه سندها را مرتب از تازه‌ترینِ ویرایش‌شده فهرست می‌کند (استور چینش ندارد، پس افزونه خودش مرتب می‌کند).

```js
const documents = await service.listDocuments();
// => [{ id: '...', title: '...', content: '...', updatedAt: 1700000000000 }]
```

### `openDocument(id)`

یک سند را با شناسه می‌خواند، یا وقتی نیست `null`.

```js
const document = await service.openDocument('doc-id');
// => record or null
```

### `saveDocument(input)`

سند را می‌سازد یا بازنویسی می‌کند، `updatedAt` می‌زند و `documents:changed` منتشر می‌کند. `id` گمشده تولید می‌شود؛ `title` گمشده/خالی می‌شود `بدون عنوان`؛ `content` گمشده می‌شود `''`. عنوانی که رکورد دیگری دارد با `DOCUMENT_TITLE_DUPLICATE` رد می‌شود؛ timestamp ساخت رکورد موجود حفظ می‌شود. قفل ذخیره‌شده می‌ماند مگر `input.readOnly` صریح بگوید.

```js
const saved = await service.saveDocument({ id: 'doc-id', title: 'یادداشت', content: '# سلام' });
```

### `createDocument(title)`

سند خالی تازه می‌سازد و عنوان را پسوند می‌زند (`title ۲` و …) تا یکتا شود.

```js
const created = await service.createDocument('ایده‌ها');
```

### `renameDocument(id, title)`

سند را با شناسه تغییرنام می‌دهد، `updatedAt` می‌زند و `documents:changed` منتشر می‌کند. وقتی شناسه نیست `null` برمی‌گرداند. عنوان‌های خالی با `DOCUMENT_INVALID_TITLE` رد می‌شوند؛ عنوان‌های تکراری با `DOCUMENT_TITLE_DUPLICATE`.

```js
const renamed = await service.renameDocument('doc-id', 'تازه');
```

### `deleteDocument(id)`

سند را با شناسه حذف می‌کند (وقتی نیست no-op) و `documents:changed` منتشر می‌کند.

```js
await service.deleteDocument('doc-id');
```

### `setReadOnly(id, readOnly)`

سند را با شناسه برای خواندن قفل یا باز می‌کند، `updatedAt` می‌زند و `documents:changed` منتشر می‌کند. وقتی شناسه نیست `null` برمی‌گرداند؛ هرچه جز `true` باز می‌کند.

```js
const locked = await service.setReadOnly('doc-id', true);
```

## ایونت‌ها

| ایونت | کی | داده |
|---|---|---|
| `documents:changed` | بعد از ذخیره یا تغییرنام یا حذف یا (باز)قفل شدن سند. | `{ id }` |

این افزونه به هیچ ایونتی گوش نمی‌دهد.

## مرجع خطاها

خطاهای استور (مثل `STORE_NOT_FOUND` و `QUOTA_EXCEEDED`) همان‌طور که‌اند از `pey.storage.service` می‌گذرند. فراخوانی هر متدی پیش از فعال‌سازی محلی یک `Error` ساده با نام سرویس گمشده throw می‌کند — در استارت‌آپ عادی بعد از settlement دست‌نیافتنی است. خطاهای اعتبارسنجی از ساختار استاندارد استفاده می‌کنند:

- `DOCUMENT_TITLE_DUPLICATE` (operational با `detail: { field: 'title' }`) — رکورد دیگری همین عنوان را دارد.
- `DOCUMENT_INVALID_TITLE` (operational با `detail: { field: 'title' }`) — عنوان خالی تغییرنام.

## پیکربندی

هیچ کلید پیکربندی. چیدمان استور (کالکشن `documents` با `keyPath: id`) پیکربندی پروژه در `bootstrap.json` است، نه پیکربندی افزونه.

## قواعد کسب‌وکار

- هر رکورد ذخیره‌شده `updatedAt` زمان ذخیره را حمل می‌کند؛ صدازننده نمی‌تواند بازنویسی‌اش کند.
- هر رکورد `createdAt` حمل می‌کند که یک‌بار موقع ساخت ست می‌شود و ذخیره‌های بعدی حفظش می‌کنند؛ رکوردهای پیش از خودش به `updatedAt` برمی‌گردند.
- هر رکورد `readOnly` حمل می‌کند (پیش‌فرض `false`)؛ `saveDocument` قفل ذخیره‌شده را نگه می‌دارد مگر `input.readOnly` صریح بگوید و `setReadOnly` برمی‌گرداندش.
- عنوان‌ها در همه رکوردها یکتایند: ذخیره یا تغییرنام روی عنوان تکراری reject می‌شود (موقع به‌روزرسانی خود رکورد مستثناست). `createDocument` با ارقام فارسی پسوند می‌زند تا آزاد شود.
- ترتیب فهرست همیشه تازه‌ترینِ ویرایش‌شده اول است.
- `openDocument` برای شناسه گمشده هرگز throw نمی‌کند — `null` برمی‌گرداند.
- `deleteDocument` برای شناسه گمشده هرگز throw نمی‌کند — آن‌وقت no-op است.
- هر ذخیره و حذف و تغییر قفل دقیقاً یک `documents:changed` با شناسه متأثر منتشر می‌کند.

## قیدها

- از UI این افزونه را دور نزن و مستقیم `pey.storage.service` را صدا نزن؛ چیدمان استور و سیاست timestamp مال اینجاست.
- در کالکشن `documents` جز رکورد سند چیز دیگری ذخیره نکن.
- `updatedAt` فقط و فقط دست `saveDocument` ست می‌شود؛ timestamp صدازننده قبول نکن.
