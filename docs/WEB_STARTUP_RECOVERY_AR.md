# تشخيص الشاشة البيضاء وتشغيل الواجهة محليًا

## ما ثبت من المستودع

مرجع الفحص: `develop` عند `dff2b1a0230c892c3ff4967ab15f9e4e5be3fabb`.

- السبب السابق الموثق في PRs #94 و#96 و#97: المتصفح كان يتلقى مخرجات CommonJS لحزمة `@homeservicemarketplace/contracts` ويطلب منها named exports بصيغة ESM. هذا يوقف تحميل JavaScript قبل تنفيذ `createRoot`.
- PR #97 المدمج أصلح حدود الحزمة: Vite يستخدم `packages/contracts/src/index.ts`؛ API يبقى على مخرجات CommonJS. لا تغيّر هذا الربط ولا تنسخ ثوابت إضافية إلى الواجهة لحل كل خطأ على حدة.
- CI وCodeQL ناجحان على المرجع أعلاه. اختبارات المتصفح السابقة تستخدم `vite preview`، فلا تكفي وحدها لإثبات سلامة `vite dev`.
- الصورة تعرض صفحة فارغة على `localhost:5173`، لكنها لا تعرض Console أو SHA النسخة المحلية. لذلك لا تثبت أن جهاز المستخدم يشغّل المرجع الحالي، ولا تثبت أن الكاش هو السبب الوحيد.

## ما تضيفه هذه المعالجة

1. تحميل أولي مستقل عن شجرة التطبيق؛ فشل import ديناميكي يعرض رسالة ثنائية اللغة وزر إعادة المحاولة مع الاحتفاظ بالتفاصيل في Console. التصميم الحالي يعود كما هو عند نجاح التحميل. هذه حماية لفشل تحميل/تهيئة الوحدات، وليست وعدًا بالتقاط كل خطأ يحدث داخل React لاحقًا.
2. `dev` يبدأ Vite مباشرة؛ لم يعد يحتاج إعادة بناء contracts لأن الواجهة تستخدم المصدر. البناء وtypecheck وAPI يحتفظون بخطوات بناء الاعتمادات.
3. منفذ 5173 ثابت مع `strictPort`: إذا كان مشغولًا يتوقف الأمر بخطأ واضح بدل تشغيل نسخة أخرى على 5174 وترك المتصفح على النسخة القديمة.
4. `dev:reset` يستخدم `--force` لإعادة إنشاء كاش التحسين دون حذف بيانات المستخدم أو ملفات البيئة أو قاعدة البيانات.
5. اختبار Chromium إضافي على خادم التطوير الفعلي: عرض شاشة الاختيار، الانتقال إلى تسجيل دخول Seeker/Provider/Admin، ظهور رسالة الفشل ثم نجاح Retry، وظهور الشاشة العامة حتى إذا تعذر الاتصال بالـAPI. يجري على سطح المكتب وعرض 390px، بلا إعادة محاولات تخفي الإخفاق. HTTP المصادقة محاكى في هذا الاختبار؛ اختبارات API الحقيقية تبقى مستقلة.

## التشغيل على Windows / PowerShell

أغلق خادم الواجهة القديم بـ Ctrl+C في نافذته. لا تغلق جميع عمليات Node؛ قد يكون API قيد التشغيل في نافذة أخرى.

من مجلد المستودع:

```powershell
git status --short --branch
git fetch origin --prune
```

إذا كانت هناك تعديلات محلية متتبعة، احفظها في commit على فرعها قبل تبديل الفرع. لا تستخدم `reset --hard` أو `clean`.

لتجربة فرع الإصلاح قبل دمجه:

```powershell
git switch fix/web-dev-startup-recovery
git pull --ff-only origin fix/web-dev-startup-recovery
pnpm install --frozen-lockfile
pnpm --filter @homeservicemarketplace/web dev:reset
```

بعد دمجه، استخدم `git switch develop` ثم `git pull --ff-only origin develop` بدل أوامر فرع الإصلاح. استخدم Node 20 وpnpm 10.32.1 طبقًا للمشروع.

افتح العنوان الذي يطبعه Vite، ثم نفّذ Ctrl+Shift+R مرة واحدة. إن ظهر أن المنفذ مشغول، اعرض مالكه دون قتله عشوائيًا:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

حدد نافذة/عملية المشروع الصحيحة وأوقفها، ثم أعد أمر `dev:reset`.

## API والتحقق

هذه المعالجة تخص بدء الواجهة. لتسجيل الدخول والعمل على البيانات يجب أن يكون API وقاعدة البيانات والخدمات التابعة قيد التشغيل وفق README، وأن يطابق `apps/web/.env` عنوان API:

```text
VITE_API_URL=http://localhost:4000
```

التحقق من جاهزية الخادم مستقل:

```powershell
Invoke-RestMethod http://localhost:4000/health/ready
```

اختبار منع تكرار العطل:

```powershell
pnpm --filter @homeservicemarketplace/web exec playwright install chromium
pnpm --filter @homeservicemarketplace/web test:dev-startup
```

إذا بقي الفشل بعد التحديث وإعادة التشغيل، يلزم أول خطأ أحمر من Console مع ناتج `git rev-parse HEAD` وسجل نافذة Vite. لا تعرض كلمات مرور أو ملفات `.env` كاملة. لم يتم الوصول إلى جهاز المستخدم أو تغيير عملياته أو بياناته من هذه الجلسة.
