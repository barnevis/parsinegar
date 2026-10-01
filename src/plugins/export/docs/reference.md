# مرجع parsinegar.export

## هدف

افزونه اپلیکیشن پارسی‌نگار: خروجی HTML فارسی — رندر Markdown (استاندارد + GFM + پارس‌نشان) روی `pey.markdown.service` و اسمبل سند مستقل راست‌به‌چپ با تم.

## ساختار

- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (فقط سیم‌کشی).
- `lib/export-service.js` — پیاده‌سازی سرویس.
- `lib/persian-extensions.js` — ساخت افزونه‌های micromark پارس‌نشان (اندرزها، لیست فارسی، شعر) و آپشن پاورقی فارسی؛ تنها نقطه تماس با پکیج `parsneshan`.
- `lib/mark-extension.js` — اکستنشن محلی `==هایلایت==` به `<mark>` (نه CommonMark، نه GFM، نه پارس‌نشان) با مکانیزم attention؛ واگرایی‌های شناخته‌شده: ران سه‌تایی کاملاً literal می‌ماند و فاصله چسبیده به جداکننده تابع flanking است.
- `lib/assemble-document.js` — اسمبل خالص سند کامل (`lang="fa" dir="rtl"`) با CSS inline سه تم؛ fragment ورودی از قبل sanitizeشده و خام جاسازی می‌شود، فقط عنوان escape می‌شود.
- `tests/` — تست‌های افزونه آینه فایل‌های سورس.
- `docs/reference.md` — همین فایل.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.markdown.service` — رندر fragment؛ همه متدها بدون آن با `EXPORT_MARKDOWN_UNAVAILABLE` صریح fail می‌شوند.
- **اختیاری:** هیچ‌کدام.

## API عمومی

**سرویس:** `parsinegar.export.service`.

### `exportHtml({ markdown, title?, theme? })`

Markdown را با افزونه‌های فارسی رندر و سند مستقل می‌سازد: `{ html, filename, mime: 'text/html' }`. `title` گمشده/خالی می‌شود `بدون عنوان` (آینه رکوردها)؛ `theme` گمشده می‌شود `light` و نامعتبر با `EXPORT_INVALID_THEME` رد می‌شود؛ خرابی رندر با `EXPORT_RENDER_FAILED` (کد اصلی در `detail.cause`)؛ filename با همان قاعده دانلود `.md` sanitize می‌شود (`/` و `\` به `-`).

```js
const { html, filename } = await service.exportHtml({ markdown: '# سلام', title: 'یادداشت', theme: 'dark' });
// => { html: '<!DOCTYPE html>…', filename: 'یادداشت.html', mime: 'text/html' }
```

## ایونت‌ها

هیچ‌کدام — خروجی محاسبه خالص است و رخداد دامنه‌ای رخ نمی‌دهد.

## نکته‌های مرزی

- `==` به `<mark>` رندر می‌شود؛ اگر sanitizer بالادستی `mark` را نشناسد، تگ می‌افتد و محتوا می‌ماند (تست parity با skip ثبتش کرده؛ بالادست باید `mark: []` را allowlist کند).
- شناسه‌های پاورقی (`user-content-*`) از sanitizer می‌گذرند، پس ناوبری پاورقی در فایل خروجی کار می‌کند.
- تصاویر راه‌دور همان URL را نگه می‌دارند (فایل مستقل، بدون embed)؛ `data:` غیرتصویری می‌افتد و alt می‌ماند.
- کد حصاردار بدون هایلایت سینتکس می‌آید (`<pre><code class="language-x">`) — آگاهانه بیرون اسکوپ.

## واگرایی‌های ثبت‌شده با ادیتور

- **پاورقی:** ادیتور `[^۱]` را ارجاع پیوندی می‌فهمد، خروجی سکشن پاورقی GFM می‌سازد (تست پین شده).
- **شعر شل:** ادیتور lenient رندر می‌کند، پارس‌نشان strict fallback به متن می‌دهد (تست پین شده).
- **شماره نامرتب لیست فارسی:** خروجی از `<ol start>` می‌شمارد (مرورگر ۲/۳ نشان می‌دهد)، ادیتور ارقام سورس را نگه می‌دارد تا بازشماره (تست رفتار خروجی پین شده).
