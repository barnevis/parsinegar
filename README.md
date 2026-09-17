# پارسی‌نگار (Parsinegar)

[![AI](https://img.shields.io/badge/Built%20with-AI-blueviolet)](#)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Bonyan Architecture](https://img.shields.io/badge/bonyan-0.11-56c3bf)](https://github.com/barnevis/bonyan)

ویرایشگر فارسی Markdown بر پایهٔ معماری Pey — سند معماری: `docs/architecture.md`. تاریخچهٔ نسخه‌ها: `CHANGELOG.md`.

میزکار تک‌صفحه‌ای راست‌به‌چپ: ویرایشگر زندهٔ CodeMirror، نوار منو (پرونده/ویرایش/افزودن/نمایش)، ریل فعالیت با پنل‌های فایل‌ها/فهرست مطالب/تنظیمات، مدیریت چندسند با autosave روی IndexedDB، نوار وضعیت زنده (نویسه/حرف/واژه/خط/حجم با ارقام فارسی) و چهار پوسته (روشن/تیره/دستگاه/سپیا) با ترجیحات پایدار.

## ساختار

```text
parsinegar/
├── src/app/          # Runtime Host (ConfigSource / EnvSource / ModuleLoader + core.start)
├── src/ui/           # رابط کاربری روی pey.webui (صفحات، کامپوننت‌ها، هلپرها + تست‌ها)
├── src/plugins/app/ # افزونهٔ اختصاصی پارسی‌نگار (مالک مسیرها)
├── src/plugins/documents/ # مدیریت چندسند روی pey.storage
├── src/plugins/settings/  # ترجیحات کاربر (پوسته، جهت، قلم) روی pey.storage
├── public/           # فایل‌های ایستا (فونت وزیرمتن، تم‌های سطح سند)
├── tests/            # آزمون‌های سطح اپ و یکپارچه‌سازی (node:test + jsdom)
├── imp/              # نیازمندی‌ها و پلن‌ها
├── bootstrap.json    # تنها محل تعریف Adapterها، Pluginها و مسیر UI
└── index.html        # لودر Host + importmap (بدون ابزار ساخت)
```

Pey و افزونه‌های آن (`@pey/core` ،`pey.router` ،`pey.webui`) وابستگی‌اند و سورس آن‌ها در این مخزن قرار نمی‌گیرد — مستقیم از GitHub نصب می‌شوند.

## اجرا

```sh
npm install
npm start     # static server روی ریشهٔ پروژه، سپس باز کردن آدرس اعلام‌شده
```

نکته: سرور باید ریشهٔ پروژه را سرو کند تا `node_modules/` (برای importmap) و `bootstrap.json` در دسترس باشند. `npm start` از `--single` استفاده می‌کند تا مسیرهای SPA مثل `/not-found` هم به `index.html` برگردند.

## آزمون

```sh
npm test
```
