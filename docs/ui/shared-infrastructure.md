# زیرساخت مشترک UI

- **کلاس پایه:** `PeyElement` کیت (خود کیت تستش می‌کند؛ اینجا تکرار نمی‌شود).
- **refs:** برابر `services` (روتر + اسناد)، `t`/`format` (کاتالوگ fa)، `assetBaseUrl` (اسپرایت آیکون)، `direction` (جهت ادیتور).
- **توکن‌ها:** سطح‌ها روی `--pey-*` نگاشت می‌شوند (`canvas`، `border`، `surface`، `text-muted`، `accent`، `focus-ring`) با fallback؛ `home-styles.js` را ببینید.
- **آیکون‌ها:** `src/ui/assets/icons.svg` مال اپ از مسیر هلپرهای `icon-sprite` کیت.
- **قلم‌ها:** وزیرمتن محلی (`public/fonts/`)، ارقام فارسی از مسیر `format`.
- نه استور حالت مشترک (تک‌مالک کامپوننت)، نه ایونت UI Bus منتشرشده (فقط اعلان `ui:component-error` که کلاس پایه لازم دارد).
