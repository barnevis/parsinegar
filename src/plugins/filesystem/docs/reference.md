# مرجع pey.filesystem

## هدف

افزونه زیرساختی Pey برای دسترسی به فایل و پوشهٔ دستگاه کاربر. منطق قابل‌حمل اینجاست (فیلتر Markdown، پیمایش بازگشتی، چرخهٔ permission، خطای ساخت‌یافته)؛ I/O محیطی تزریق می‌شود: pickerها از بیرون می‌آیند و افزونه هرگز به DOM دست نمی‌زند.

## شکل ورودی (Entry)

```text
{ name: string, path: string, handle?: FileSystemFileHandle, file?: File-like }
```

- `pickDirectory`/`pickFile` ورودی handleدار برمی‌گردانند (`path` همان نام ریشه است).
- `listDirectory` ورودی‌های handleدار با مسیر نسبی (`sub/note.md`) برمی‌گرداند.
- `collectEntries` ورودی‌های fileدار با مسیر `webkitRelativePath` (یا نام) برمی‌گرداند.

نام Markdown یعنی پسوند یکی از `.md` / `.markdown` / `.mdown` / `.txt` (غیرحساس به حروف).

## API عمومی

- `getCapabilities()` → `{ directoryPicker, filePicker, writable }` — `writable` یعنی ورودی‌های انتخاب‌شده قابل بازنویسی‌اند (فقط handleها).
- `pickDirectory(picker)` / `pickFile(picker)` — `picker` تابع picker محیط یا `null`؛ `null` وقتی picker نیست یا کاربر لغو کرد (AbortError).
- `listDirectory(handle)` — پیمایش بازگشتی؛ فقط Markdown؛ لیست تخت با مسیر نسبی.
- `collectEntries(files)` — فیلتر لیست تخت؛ خالص.
- `readEntry(entry)` — از handle (با round-trip اجازهٔ `read`) یا فایل ساده؛ BOM ابتدایی حذف می‌شود.
- `writeEntry(entry, content)` — از handle (با round-trip اجازهٔ `readwrite`)؛ وقتی ورودی handle نوشتنی ندارد `null` برمی‌گرداند تا فراخوان fallback کند (مثلاً دانلود)؛ `{ name, path }` در موفقیت.

## خطاها (ساختار استاندارد بنیان)

- `FILESYSTEM_PICK_FAILED` — picker پرتاب غیرلغوی داشت.
- `FILESYSTEM_READ_FAILED` — پیمایش/خواندن ناممکن (یا ورودی چیزی برای خواندن ندارد).
- `FILESYSTEM_WRITE_FAILED` — نوشتن ناممکن (یا محتوا متن نیست).
- `FILESYSTEM_PERMISSION_DENIED` — کاربر اجازه را نداد.

## وابستگی‌ها

- **لازم:** هیچ‌کدام. **اختیاری:** هیچ‌کدام. بدون `adapterType` (تکنولوژی بیرونیِ آداپتری مصرف نمی‌کند).
