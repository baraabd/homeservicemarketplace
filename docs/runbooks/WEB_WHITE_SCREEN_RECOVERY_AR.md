# استعادة الواجهة عند خطأ contracts والشاشة البيضاء

نطاق الإصلاح: تشغيل واجهة الويب، مع الحفاظ على التصميم والصلاحيات والعقود الحالية.

## التشخيص

الخطأ المبلغ عنه:

```text
The requested module .../packages/contracts/dist/index.js
 does not provide an export named 'LEGACY_PUBLICATION_ACK_TEXT'
```

الثابت موجود في المصدر. حزمة `contracts` تُبنى بصيغة CommonJS للخادم، بينما
`apps/web/vite.config.ts` يوجّه الواجهة إلى `packages/contracts/src/index.ts`
ليحوّل Vite المصدر إلى ESM للمتصفح.

كان `tsconfig.node.json` يسمح بتوليد `vite.config.js` بجانب ملف TypeScript.
أوامر التشغيل السابقة كانت تعتمد على اكتشاف الإعداد تلقائيًا. لذلك يمكن لملف
JavaScript قديم، باقٍ من بناء سابق، أن يتجاوز الإعداد الحديث بعد `git pull`.
الصورة وحدها لا تثبت وجود هذا الملف على الجهاز؛ يؤكد فحص الملفات والإعداد
المحمّل ذلك. كما يجب التحقق من الفرع والنسخة ومسار عملية التشغيل.

الإصلاح يحدد `--config vite.config.ts` في أوامر `dev` و`build` و`preview`،
ويمنع توليد ملفات JavaScript من مشروع إعداد Vite باستخدام `noEmit`.
لا يتطلب حذف `node_modules`، أو قاعدة البيانات، أو ملفات البيئة، أو تعديل
الثابت أو نسخه داخل مكونات الواجهة.

## تشغيل سريع لتجاوز ملف الإعداد القديم

أوقف عملية واجهة الويب الخاصة بهذا المشروع باستخدام `Ctrl+C` في نافذتها.
لا توقف جميع عمليات Node، ولا توقف API العامل.

```powershell
Set-Location 'C:\Users\mohab\Documents\GitHub\Homeservicesmarketplace'
git status --short --branch
git rev-parse HEAD
Get-ChildItem .\apps\web\vite.config.*
Select-String -Path .\apps\web\vite.config.ts -Pattern 'packages/contracts/src/index.ts'
pnpm --filter @homeservicemarketplace/web exec vite --config vite.config.ts --force --host localhost --port 5173 --strictPort
```

يجب أن يتضمن ملف TypeScript إعداد `contracts` إلى المصدر قبل هذا التشغيل.
افتح `http://localhost:5173` واحتفظ بإعدادات API وCORS المحلية المتوافقة
مع هذا العنوان؛ لا تغيّر إعدادات الجلسات أو المصادقة لمعالجة خطأ الاستيراد.

استخدم `Ctrl+Shift+R` مرة واحدة. خيار `--force` مخصص لاستعادة الكاش في هذه
المحاولة؛ ليس مطلوبًا إضافته دائمًا. خيار `--strictPort` يمنع فتح نسخة جديدة
بصمت على منفذ آخر عندما يكون 5173 مشغولًا.

## جلب فرع الإصلاح دون الكتابة فوق التعديلات المحلية

```powershell
git status --short --branch
git fetch origin --prune
```

راجع واحفظ أي تعديلات محلية قبل تغيير الفرع؛ لا تستخدم `reset --hard` أو
`git clean`. عندما تكون شجرة العمل آمنة للتبديل:

```powershell
git switch --track origin/fix/web-startup-config-shadowing
pnpm install --frozen-lockfile
pnpm --filter @homeservicemarketplace/web dev --force --port 5173 --strictPort
```

إذا كان الفرع المحلي موجودًا بالفعل، استخدم `git switch fix/web-startup-config-shadowing`
بدل إنشاء فرع تتبع آخر. لا تعني هذه الخطوة أن الإصلاح دُمج في `develop`.

## اختبار المتصفح وإثبات عدم عودة الخطأ

```powershell
pnpm --filter @homeservicemarketplace/web exec playwright install chromium
pnpm --filter @homeservicemarketplace/web test:startup
pnpm --filter @homeservicemarketplace/web typecheck:e2e
```

يعمل الاختبار في نسخة مؤقتة معزولة من مصدر الواجهة، ولا يستبدل ملفات إعداد
المطور أو ملفات `.env`. يحتاج إلى تثبيت اعتمادات المشروع أولًا.

يختبر عدم توليد `vite.config.js` من TypeScript، ثم يُدخل إعدادًا قديمًا
متعارضًا لإعادة إنتاج الشاشة البيضاء. بعد ذلك يشغّل أمر `pnpm dev` الحقيقي
مع بقاء ذلك الملف، ويفحص الصفحة العامة ومركز الموافقات وقائمة المراجعات،
باللغتين العربية والإنجليزية وبمقاسي الهاتف وسطح المكتب، مع إعادة التحميل.

تُحفظ الصور والسجلات تحت `apps/web/test-results/startup/` والتقرير تحت
`apps/web/test-results/startup-report/`. سير عمل `Web development startup`
ينفذ هذه الاختبارات على Linux وWindows.

طلبات API في هذا الاختبار لها استجابات اختبارية ثابتة. نجاحه يثبت تحميل
الواجهة ومساراتها تحت هذا السيناريو، وليس تسجيل الدخول الحقيقي أو الموافقات
أو الدفع أو الحفظ في قاعدة البيانات. تبقى اختبارات API وreal-route وCI
الأخرى مطلوبة قبل الدمج، ولا تُستبدل بهذا الاختبار.
