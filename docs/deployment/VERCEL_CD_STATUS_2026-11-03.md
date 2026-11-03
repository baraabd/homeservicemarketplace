# سجل تجهيز Vercel CD — 2026-11-03

هذا سجل تحقق وتجهيز مصدر وحسابات، وليس إثبات نشر الإصدار الجديد أو تفعيل CD.
التعليمات التشغيلية في [VERCEL_CD.md](./VERCEL_CD.md).

## المصدر والتغييرات

- المستودع: `baraabd/homeservicemarketplace`.
- قاعدة العمل: develop عند `92770ea65ee1154f94f4251d5febfa39822f9b9a`.
- أضيف workflow للواجهة مع staging/develop وproduction/main، وبوابات
  فحوص مرتبطة بـSHA نفسه، وفحص API منشور مسبقًا قبل النشر.
- أضيف التحقق من نطاقات الكوكيز بـPublic Suffix List ومن ربط نطاق
  الواجهة بالمشروع والبيئة في Vercel.
- أُصلحت اعتمادات qs إلى `6.16.2` وfollow-redirects إلى `1.16.2`
  وVite إلى `6.4.5` دون تعديل API أو واجهات المستخدم.
- لم تُعدّل schema أو migrations أو بيانات مستخدمين. بعد ربط Vercel قُبل
  تحديث إعدادات بناء مشروع الواجهة كما هو موثق أدناه.

## التحقق المحلي المنفذ

استُخدم Node `24.21.0` وpnpm `10.32.1`. ملفات الإصدار الجديدة لا تحتاج
إلى مكتبات خارجية لتشغيل اختبارات الضوابط.

| الفحص                                                 | النتيجة                                          |
| ----------------------------------------------------- | ------------------------------------------------ |
| `pnpm install --frozen-lockfile` مع lifecycle scripts | ناجح                                             |
| بناء الواجهة للإنتاج                                  | ناجح                                             |
| اختبارات الواجهة                                      | 226 ملفًا، 2729 اختبارًا ناجحًا                  |
| اختبارات API المستهدفة للأمان وHTTP والكوكيز          | 6 مجموعات، 116 اختبارًا ناجحًا                   |
| توليد Prisma Client وبناء API وdatabase وcontracts    | ناجح                                             |
| تحميل ملفات إعداد API الناتجة                         | ناجح                                             |
| اختبارات CD وPR acceptance وPSL وHTTP smoke           | 260 اختبارًا ناجحًا                              |
| ESLint للملفات البرمجية الجديدة                       | ناجح                                             |
| actionlint 1.7.12 للـworkflows المعدّلة               | ناجح؛ دون shellcheck/pyflakes                    |
| فحص الاعتمادات المستخدمة في الإنتاج                   | صفر تنبيهات                                      |
| فحص جميع الاعتمادات                                   | 6 تنبيهات: 5 متوسطة وواحدة منخفضة؛ ما زال فاشلًا |

كذلك نجحت جميع اختبارات governance وdeployment مجتمعة: **681 اختبارًا**،
وتتضمن مجموعة الـ260 المذكورة أعلاه.

بناء الواجهة استخدم origins اصطناعية تحت example.sa. اختبارات API
وتوليد Prisma استخدمت إعدادات اختبار محلية، دون الاتصال بقاعدة بيانات حقيقية.
HTTP probes لديها اختبارات بعينات استجابة؛ لم تُنفذ على نشرة Vercel حية.
لا تمثل هذه النتائج قبولًا لرحلات مستخدم مستضافة أو إثبات جاهزية إنتاج.

## التحقق من الحسابات بعد ربط الإضافات

أصبح اتصال Vercel مصادقًا للفريق بعد إكمال تفويض الفريق المطلوب من المنصة.
وأصبح اتصال Railway متاحًا كذلك. النتائج التالية قراءات فعلية للحسابين:

| العنصر                      | النتيجة                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| Vercel team                 | `baraa-abdullatifs-projects`                                                 |
| Vercel project              | `homeservicemarketplace-web`                                                 |
| Team ID                     | `team_LGL2uTTsmbGU72EMvonS1E5j`                                              |
| Project ID                  | `prj_YPWCvQrGCiVIweinDodgBXIPFxtH`                                           |
| دومين الإنتاج الموجود       | `findservice.site`؛ موثّق ومربوط بالمشروع                                    |
| DNS                         | فحص Vercel أعاد `misconfigured=false`                                        |
| طلب HTTP عام للدومين        | `200` وHTML بعنوان On-Demand Home Services Marketplace                       |
| نشرة Production الموجودة    | مصدر main عند `433165af7fa8a6a733e2d59873fcacbb0d5387c6`                     |
| مفاتيح Vercel الموجودة      | `RESEND_API_KEY` و`ENABLE_EXPERIMENTAL_COREPACK` فقط؛ لم تُقرأ القيم         |
| متغيرات الربط الحالية       | لا `VITE_API_URL` أو أعلام VITE المطلوبة؛ عدد متغيرات Production المخفية صفر |
| Railway                     | workspace واحد متاح وثلاثة مشاريع HighStyle، كلها مرتبطة بمستودع مختلف       |
| موارد HSM في Railway المتاح | لا مشروع أو API أو PostgreSQL أو Redis أو buckets أو volumes خاص بـHSM       |

قَبِل Vercel طلب تحديث المشروع إلى root `apps/web` وframework `vite`،
مع تضمين ملفات workspace خارج root، وinstall/build/output الموثقة في
[الدليل](./VERCEL_CD.md). بقي Node major `24.x`؛ يبني CD مستقبلًا باستخدام
patch المثبت في Actions. نتيجة أداة القراءة لا تعرض حقول البناء كاملة،
لذلك يلزم التحقق منها مجددًا بواسطة `vercel pull` في أول تشغيل مصادق.

استجابة الدومين الحالية تخص النشرة القديمة؛ لم نرفع artifact جديدًا،
ولم نغيّر production alias أو ننفذ Resume. حقل `live` الذي تعيده أداة
المشروع لا يُستخدم وحده للحكم على Pause؛ الدومين نفسه أجاب `200`.

عدم ظهور HSM في Railway لا يثبت حذف بياناته السابقة. يجب تحديد مشروعه
أو مزود قاعدة بياناته السابق، أو اعتماد بدء بنية جديدة ببيانات جديدة.
لم تُعدّل مشاريع HighStyle أو تُستخدم مواردها لهذا التطبيق.

## نتائج أول رأس منشور لطلب السحب

المصدر `bb8d3a35c126c010544abb2de214bbecdc005793`:

- [Web startup، بما فيه Windows](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890876): ناجح.
- [Production governance](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890785): ناجح.
- [Staging boundary](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890893)،
  [Auth lifecycle](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890612)،
  [R26](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890685)
  و[CodeQL workflow](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890731): ناجحة.
- [CI](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890802):
  فشل audit للنتائج الست الباقية، وفحص الأسرار التقط hostname تجريبيًا
  بصيغة IDNA داخل اختبار PSL. أُعيدت صياغة fixture دون استثناءات؛ نجحت
  اختبارات PSL الـ49 وفحص الشجرة المعدلة باستخدام Gitleaks `8.24.3`
  دون تسريبات. يلزم نجاح فحص المصدر النهائي على GitHub.
- [R27](https://github.com/baraabd/homeservicemarketplace/actions/runs/41683890739):
  توقف قبل قياس الأداء لأن ضوابط مقارنة الاعتماديات لم تكن تسجل التحديثات
  الجديدة. يتطلب التصحيح commits مستقلة للاعتماديات وسجلًا مطابقًا، دون
  تغيير ميزانيات الأداء أو اعتبار الفشل قياسًا لانحدار أداء.

أُنشئ مرجع R27 تاريخي جديد `25a1e572bfeade398297224a608b1238e81e43a1`
بأب واحد `462418888be76ec642664ea77971da9239ffb02a`، مع تغيير ملفات
الاعتماديات الأربعة فقط. أُعيد استخدام repair control المنشور
`5435543628f367d5766a5bef41f166c743e9f3a5`، وهو ancestor لرأس PR.
سُجلت البصمات الفعلية وحدث pin في workflow؛ نجحت اختبارات الضابط الـ19
والـCLI الفعلي على مرشح محلي ذي ancestry مطابق للمصدر المنشور.
هذا تحقق من صلاحية المقارنة، وليس نتيجة قياس أداء.

الفرع `control/r27-vercel-cd-baseline` يحتفظ بالمرجع التاريخي ليجلبه
checkout الكامل؛ لا تحذفه مع تنظيف فروع PR العادية ما دام workflow يشير إليه.

لا تثبت نتيجة رأس قديم نجاح رأس أحدث؛ تُراجع نتائج SHA النهائي بعد نشره.

## موانع الدمج والتفعيل القائمة

1. **الأمان:** بقيت ست نتائج لأدوات التطوير في deepmerge/minimatch/glob.
   لم تُضعف سياسة audit أو تُخفَ التنبيهات أو تُفرض major overrides غير مختبرة.
2. **المصدر النهائي:** يلزم اكتمال فحوص الإصلاحات على رأس طلب السحب الجديد،
   بما فيها فحص الأسرار وضوابط R27 والقياسات الفعلية.
3. **مكان الـAPI والبيانات:** لا توجد بنية HSM في Railway المتاح. لم تُفحص
   قاعدة البيانات القديمة أو backups ولم تُنفذ migrations أو استعادة.
4. **CD الخلفي:** المسار الجديد يتحقق من API جاهز على SHA المطلوب.
   لا ينشر Railway ولا ينشئ الموارد ولا يشغّل migrator؛ يلزم تحديد
   خدمات التطبيق والبيانات أولًا.
5. **إعدادات التشغيل:** لم تُضبط origins للـAPI أو قيم GitHub Environments
   وأسرار CD. لا يوفر تكامل GitHub الحالي أدوات إدارة environment secrets.
   لم تُنفذ رحلات login/OTP/refresh/upload/booking/WSS على نشر جديد.

فحوص قاعدة العمل التاريخية على GitHub:

- [CI — فشل فحص الاعتمادات](https://github.com/baraabd/homeservicemarketplace/actions/runs/41093704746)
- [Web startup — فشل Windows](https://github.com/baraabd/homeservicemarketplace/actions/runs/41093704442)

تبقى التغييرات Draft إلى أن تنجح بوابات المصدر المطلوب وتُربط البيئات
الفعلية. لا يلزم إرسال أي token أو password في المحادثة؛ تُضبط الأسرار
داخل الحسابات وGitHub Environments.
