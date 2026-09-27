# نقطه ورود UI

`src/ui/index.js` (اقتباس از قالب اپلیکیشن `pey.webui`) شل را سوار می‌کند، میزبان صفحه را با کاتالوگ مسیرهای `/` + `/not-found` می‌سازد و مونت اولیه مسیر را انجام می‌دهد (ثبت مسیرها پیش از subscribe رابط کاربری publish می‌شود — `../decisions.md` را ببینید).

به صفحه‌ها `{ services, t, format, assetBaseUrl, direction }` را به‌عنوان refs می‌دهد (`services` حامل `pey.router.service` و `parsinegar.documents.service` و `parsinegar.settings.service` است، هر سه در `src/ui/manifest.json` از نوع `required`). پاک‌سازی در `context.onShutdown` سنکرون است (لغو subscribe تنظیمات، خالی کردن استور، برداشتن تم سند، dispose میزبان، برداشتن شل)؛ `core:shutdown` فقط اطلاع‌رسانی است.

## پل پوسته

نقطه ورود مالک تم ران‌تایم است: استور حالت مشترک محلی کیت (`createSharedState`) را می‌سازد، به شل می‌دهد (که `theme` را به‌صورت `data-theme` بازتاب می‌دهد)، تم ذخیره‌شده را یک‌بار در استارت‌آپ می‌خواند و روی هر ایونت دامنه `settings:changed` دوباره اعمال می‌کند (از زنجیره نوشتن سریال می‌گذرد تا ذخیره‌های پشت‌سرهم به ترتیب همگرا شوند). مقدار ذخیره‌شده `device` پیش از بازتاب به واژگان کیت یعنی `system` نرمال می‌شود — وگرنه با هیچ اسکوپ استایل‌شیتی جور درنمی‌آمد در حالی که ادیتور مستقل تیره را resolve می‌کرد و متن روشن روی صفحه روشن می‌ماند. هر اعمال، مقدار نرمال را هم در استور و هم در `document.documentElement.dataset.theme` می‌نویسد — اسکوپ سند بازنویسی‌های توکن تیره در `public/theme.css` را حمل می‌کند که استایل‌های head-injected ادیتور هم resolveشان می‌کنند. `../decisions.md` §۱۲ را ببینید.
