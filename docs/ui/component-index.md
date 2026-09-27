# نمایه کامپوننت‌های UI

اپ تک‌صفحه‌ای (`fa`، راست‌به‌چپ).

| تگ | فایل | نقش |
|---|---|---|
| `parsi-page-home` | `src/ui/pages/home/home.js` (به‌علاوه `home.css`، [سند](../../src/ui/pages/home/home.md)) | شل میزکار: پنج فرزند و ادیتور CodeMirror را سوار می‌کند |
| `parsi-menu-bar` | `src/ui/components/menu-bar/menu-bar.js` ([سند](../../src/ui/components/menu-bar/menu-bar.md)) | نوار منو (پرونده/ویرایش/افزودن/نمایش/راهنما) به‌علاوه دراپ‌دان جست‌وجو و دکمه تاگل حالت؛ `menu-action` و ایونت‌های `search-*` را منتشر می‌کند |
| `parsi-activity-rail` | `src/ui/components/activity-rail/activity-rail.js` ([سند](../../src/ui/components/activity-rail/activity-rail.md)) | ریل تعویض نما؛ `view-select` منتشر می‌کند |
| `parsi-side-panel` | `src/ui/components/side-panel/side-panel.js` ([سند](../../src/ui/components/side-panel/side-panel.md)) | پنل کناری سندها/فهرست؛ `document-*` و `outline-jump` و `side-close` منتشر می‌کند |
| `parsi-status-bar` | `src/ui/components/status-bar/status-bar.js` ([سند](../../src/ui/components/status-bar/status-bar.md)) | نوار آمار زنده به‌علاوه چیپ فقط-خواندنی (نمایشیِ صرف) |
| `parsi-page-not-found` | `src/ui/pages/not-found/not-found.js` ([سند](../../src/ui/pages/not-found/not-found.md)) | صفحه جایگزین |

ماژول‌های هلپر (المنت نیستند): `components/editor/` ([سند](../../src/ui/components/editor/editor.md): کنترلر نمای CodeMirror، نمای زنده، ادامه/تورفتگی فهرست، تسک، هایلایت متن، جست‌وجو، تصویر، جدول، دنبال‌کردن پیوند، اندرز، شعر)، `components/workbench/` ([سند](../../src/ui/components/workbench/workbench.md): رجیستری نماها، رندررهای بدنه نماها، مدل منو، فرم جست‌وجو، آمار، فهرست، html، مودال)، `utils/mount.js` (هلپر ترکیب فرزند).

| مسیر | صفحه | مالک |
|---|---|---|
| `/` | `parsi-page-home` | `parsinegar.app` ثبتش می‌کند |
| `/not-found` | `parsi-page-not-found` | `parsinegar.app` ثبتش می‌کند |
