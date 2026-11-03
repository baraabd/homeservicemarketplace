# إعادة تشغيل النشر المستمر على Vercel

تاريخ الإعداد: 2026-11-03. النطاق: **Mode A — Integration and Bug-Fix**.

هذه تعليمات CD الحالية للواجهة. وجود الملفات لا يعني إعداد حسابات الاستضافة
أو GitHub Environments أو نجاح نشر مستضاف. المسار الجديد ينشر الواجهة بعد
التحقق من API منشور مسبقًا؛ لا ينشئ خدمات Railway أو قاعدة بيانات ولا يطبق
migrations. إكمال CD للـAPI يتطلب ربط حساب الاستضافة وتحديد خدمة التطبيق
وخدمة migration والموارد الموجودة لكل بيئة.

## 1. سبب التعطيل واختيار طريقة النشر

- كان `apps/web/vercel.json` يحتوي `git.deploymentEnabled=false`.
- كانت workflows الحالية للتحقق فقط، دون مسار نشر بديل.
- المشروع يفرض Node `24.21.0` بالضبط وpnpm `10.32.1`. اختيار `24.x`
  في لوحة Vercel لا يضمن نفس patch الذي يفحصه `preinstall`.
- جلسات واجهة `*.vercel.app` لا تعمل مباشرة مع API على `*.railway.app`
  بعقد الكوكيز الحالي؛ راجع [ADR 0001](../adr/0001-web-api-deployment-topology.md).

المسار الجديد يستخدم **GitHub Actions مالكًا وحيدًا للنشر**، ويبني بالإصدارات
الدقيقة ثم يرفع output جاهزًا بـ`--prebuilt`.
يبقى `git.deploymentEnabled=false` مقصودًا لمنع نشر Git أصلي مكرر.
هذا الإعداد لا يمنع نشر Vercel CLI.

## 2. البيئات والفروع

| البيئة        | المصدر    | هدف Vercel                            | بيانات التشغيل            |
| ------------- | --------- | ------------------------------------- | ------------------------- |
| Development   | محلي      | غير منشور                             | Docker محلي               |
| Staging       | `develop` | Preview، بمتغيرات develop ودومين ثابت | موارد اختبار مستقلة       |
| Production    | `main`    | Production                            | موارد وأسرار إنتاج منفصلة |
| Pull requests | CI على PR | لا نشر تلقائي في هذا المسار           | لا أسرار استضافة في PR    |

تستخدم staging بيئة Preview الاعتيادية؛ لا يلزم شراء Custom Environment
إضافية. رابط artifact العشوائي في vercel.app ليس الدومين الوظيفي الذي
تعمل عليه جلسات الدخول.

الفرع الافتراضي للمستودع هو develop، لكن المسار يخصص main للإنتاج. لا ينسخ
الكود إلى main ولا يدمج تلقائيًا. يجب أن يصل الإصدار المقصود إلى main
بالطريقة المعتادة وأن يجتاز فحوص push على SHA الناتج نفسه.

## 3. استعادة مشروع Vercel الموجود

تم التحقق من وجود `homeservicemarketplace-web` داخل
`baraa-abdullatifs-projects` بتاريخ 2026-11-03. بيانات الربط الحالية:

- `VERCEL_ORG_ID=team_LGL2uTTsmbGU72EMvonS1E5j`
- `VERCEL_PROJECT_ID=prj_YPWCvQrGCiVIweinDodgBXIPFxtH`
- دومين Production الموجود: `https://findservice.site`.

هذه معرّفات وليست أسرارًا. كانت نشرة Production الموجودة من main عند
`433165af7fa8a6a733e2d59873fcacbb0d5387c6`، وأجاب الدومين HTTP `200`.
قُبل تحديث إعدادات البناء التالية في المشروع؛ تحقق منها بـ`vercel pull`
قبل أول نشر جديد. راجع [سجل الحالة](./VERCEL_CD_STATUS_2026-11-03.md).

1. إن كان Paused، استخدم Resume Project في Settings → General.
2. تحقق من ربط `baraabd/homeservicemarketplace`.
3. طابق الإعدادات التالية:

| الإعداد                                     | القيمة                                            |
| ------------------------------------------- | ------------------------------------------------- |
| Framework                                   | Vite                                              |
| Root Directory                              | `apps/web`                                        |
| Include source files outside Root Directory | مفعّل لحزم workspace                              |
| Install Command                             | `pnpm install --frozen-lockfile`                  |
| Build Command                               | `pnpm --filter @homeservicemarketplace/web build` |
| Output Directory                            | `dist`                                            |
| Node major في اللوحة                        | `24.x`؛ Actions يختار `24.21.0` بالضبط            |
| Production Branch                           | `main`                                            |

4. افحص Ignored Build Step وأي إيقاف قديم في اللوحة. لا تُفعّل Native Git
   deployment بالتوازي مع المسار الجديد.
5. استخرج Project ID وTeam/Org ID الفعليين؛ اسم المشروع ليس Project ID.
6. اربط دومين staging بـPreview/develop، ودومين الإنتاج بـProduction.
   عند استعمال مشروع واحد، **لا تترك دومين staging ضمن production domains**
   كي لا يعيد promote تعيينه.
7. انسخ سجلات DNS التي يعرضها Vercel للدومين والمشروع الحاليين؛ لا توجد
   سجلات A/CNAME ثابتة مخمّنة في هذا الدليل.

تنفذ أوامر CLI من **جذر monorepo**، وليس من داخل apps/web.

## 4. GitHub Environments

في Settings → Environments أنشئ أو أعد استخدام `staging` و`production`.
قيد فروع النشر إلى develop للأولى وmain للثانية. احتفظ بأي reviewers أو
deployment protection قائمة؛ سيحترمها المسار.

لكل بيئة أضف Variables:

| الاسم               | مصدره                                               |
| ------------------- | --------------------------------------------------- |
| `VERCEL_ORG_ID`     | معرف فريق Vercel الحالي                             |
| `VERCEL_PROJECT_ID` | معرف مشروع الواجهة                                  |
| `HSM_WEB_ORIGIN`    | HTTPS origin للدومين الوظيفي الثابت، دون slash أخير |
| `HSM_API_ORIGIN`    | HTTPS origin للـAPI، دون `/v1` أو slash أخير        |
| `HSM_COOKIE_DOMAIN` | parent domain مملوك مشترك، مطابق لإعداد API         |

والـSecrets:

| الاسم                             | الاستخدام                                               |
| --------------------------------- | ------------------------------------------------------- |
| `VERCEL_TOKEN`                    | النشر إلى المشروع/الفريق المصرح به                      |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | اختياري عندما تمنع Deployment Protection فحص HTTP الآلي |

ضع الأسرار مباشرة في Secrets أو عبر مدير أسرار. لا ترسلها في chat أو
commit أو PR. لا تستخدم account token كـHTTP bypass secret.
لا تحفظ DATABASE_URL أو مفاتيح S3/SMTP في مشروع الواجهة.

يفشل workflow عند نقص الإعدادات. إنشاء أسماء Environments آليًا لا يزودها
بالقيم أو الحماية ولا يثبت عزل مواردها.

## 5. متغيرات Vercel العامة للبناء

أضف القيم لكل من Production وPreview، مع تخصيص Preview لفرع develop.
يسحب المسار هذه القيم بـ`vercel pull` ويفحصها قبل البناء.

| المتغير                       | العقد                                       |
| ----------------------------- | ------------------------------------------- |
| `VITE_API_URL`                | يطابق HSM_API_ORIGIN تمامًا؛ بلا `/v1`      |
| `VITE_PROVIDER_ONBOARDING_V2` | `true` أو `false` صراحة وفق rollout المعتمد |
| `VITE_REALTIME_SOCKET_IO`     | `true` أو `false` صراحة، مطابق لإعداد API   |
| `VITE_REALTIME_TRANSPORTS`    | `websocket` عندما يكون realtime مفعّلًا     |
| `VITE_STRIPE_SANDBOX_ENABLED` | `false` ما لم يكن sandbox مقصودًا           |
| `VITE_CSP_MEDIA_ORIGINS`      | origins دقيقة لعرض S3/CDN، مفصولة بفواصل    |
| `VITE_CSP_UPLOAD_ORIGINS`     | origins دقيقة لرفع S3، مفصولة بفواصل        |

كل VITE\_\* عام ويمكن أن يظهر داخل JavaScript الذي ينزله المتصفح.
تغيير متغير في اللوحة لا يغيّر نشرة قديمة؛ يلزم build/deploy جديد.
المسار لا يفعّل المدفوعات الحقيقية أو سياسات سحب الأموال.

## 6. الدومينات والكوكيز

يدعم المسار HTTPS web وAPI على hosts مختلفة تحت parent مملوك واحد
لكل بيئة (Topology B في ADR 0001). لا يضيف reverse proxy غير مختبر.

مثال توضيحي، وليس دومينات جرى إعدادها:

| البيئة     | Web                      | API                      | Cookie domain         |
| ---------- | ------------------------ | ------------------------ | --------------------- |
| Staging    | `app.staging.example.sa` | `api.staging.example.sa` | `.staging.example.sa` |
| Production | `app.prod.example.sa`    | `api.prod.example.sa`    | `.prod.example.sa`    |

يفحص المسار أن web وAPI يشتركان في registrable domain، وأن cookie parent
ليس public suffix، باستخدام snapshot مثبتة من Public Suffix List تشمل
القواعد الخاصة بمنصات الاستضافة. هذا الفحص لا يثبت ملكية DNS أو سلوك المتصفح.
ويتحقق من Vercel API أن دومين الواجهة موثق ومربوط بالمشروع والبيئة الصحيحين؛
دومين staging يجب أن يتتبع develop، ودومين production لا يتتبع Preview branch.
اختر scopes منفصلة؛ `.example.sa` يشمل hosts الاختبار التي تقع تحته.
إن اخترت app.example.sa وapi.example.sa للإنتاج، صمم فصل staging وفق ذلك.

على API تضبط القيم المطابقة لهذه البيئة:

```dotenv
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=<نفس HSM_COOKIE_DOMAIN>
FRONTEND_URL=<نفس HSM_WEB_ORIGIN>
CORS_ORIGINS=<HSM_WEB_ORIGIN وأي origins معتمدة بدقة>
PUBLIC_API_URL=<نفس HSM_API_ORIGIN>
```

يشترك REST وSocket.IO في VITE_API_URL؛ يتجه WSS إلى API مباشرة.
rewrite لـ`/v1/*` وحده لا يشغّل `/socket.io/`.
يبقى hsm_rt وhsm_csrf مضبوطين على SameSite=Strict. لا تغيّر عقد
SameSite أو تستخدم bearer tokens في المتصفح لحل اختلاف الدومينات.

## 7. API والبيانات المطلوبة قبل نشر الواجهة

أعد تشغيل الموارد الموجودة إن كانت محفوظة. وجود مشروع Vercel لا يثبت
بقاء قاعدة البيانات القديمة. إن حُذفت، يلزم backup محدد واستعادة مُتحقق
منها؛ redeploy لا يعيد بيانات محذوفة.

المراجع:
[runtime-policy.ts](../../apps/api/src/config/runtime-policy.ts) و
[STAGING.md](../../infra/production/STAGING.md).

| المجموعة   | المطلوب                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| Runtime    | NODE_ENV=production وAPP_ENV=staging أو prod                                |
| PostgreSQL | TLS صارم: `sslmode=require&sslaccept=strict`؛ app/migration roles منفصلان   |
| Redis      | REDIS_HOST/PORT/PASSWORD/DB وREDIS_TLS=true؛ الكود لا يقرأ REDIS_URL        |
| الجلسات    | JWT قوي وفريد، email verification مفعّل                                     |
| الرسائل    | SMTP فعلي ومرسل موثق، OUTBOX_WORKER_ENABLED=true                            |
| الملفات    | STORAGE_DRIVER=s3 وثلاث buckets مختلفة: public/restricted/portfolio staging |
| فحص الهوية | ClamAV فعلي وEVIDENCE_SCAN_WORKER_ENABLED=true                              |
| Realtime   | متوافق مع الواجهة؛ Redis مشترك بين replicas داخل البيئة                     |
| MongoDB    | اختياري، ولا يُنشأ أو يُفعّل لمجرد النشر                                    |

افصل Redis instances بين البيئات؛ اختلاف REDIS_DB لا يعزل Pub/Sub.
طابق S3 CORS وCSP مع origins/headers المطلوبة للرفع.
اضبط TRUST_PROXY_HOPS وفق الشبكة المثبتة فعليًا.

تسلسل إصدار API:

1. نجاح جميع فحوص source SHA المقصود.
2. بناء runner وmigrator من apps/api/Dockerfile بنفس SOURCE_SHA،
   وتثبيت digests/provenance في وسيلة النشر الخلفية.
3. preflight بالبيئة الحقيقية:
   `node deploy/check-runtime.cjs /app`.
4. migration منفصلة مرة واحدة باستخدام role خاص:
   `node_modules/.bin/prisma migrate deploy`.
5. نجاح migration قبل استبدال API، ثم تشغيل
   `node deploy/start-api.cjs /app`.
6. نجاح /health/ready وتطابق sourceSha في /health/live.
7. استمرار نشر Vercel على SHA نفسه.

لا تستخدم migrate reset أو db push أو seed تلقائيًا في الإنتاج.
لا تشغل migration أثناء build Vercel أو startup لكل replica.

**Railway:** runner الحالي لا يحتوي Prisma CLI؛ لا تضف pre-deploy
prisma migrate deploy بافتراض وجوده. يلزم مسار migrator مستقل أو صورة
وتكامل مصممان ومختبران لذلك. كما أن railway run ينفذ محليًا ولا يصل
تلقائيًا إلى شبكة Railway الخاصة. هذا المسار لا يدّعي تنفيذ ذلك الجزء
قبل معرفة الخدمات الفعلية.

## 8. تسلسل CD

`.github/workflows/cd-vercel.yml` يبدأ عند push إلى develop/main أو
تشغيل يدوي من الفرع الموافق. بوابة الانتظار للقراءة فقط ومدتها القصوى
30 دقيقة؛ لا يبدأ deployment قبل نجاحها.

1. تثبيت full SHA وفرع الهدف.
2. فحص أحدث run/attempt لبوابات CI وCodeQL وProduction governance
   وWeb startup وStaging boundary وAuth lifecycle وR26 على نفس push.
   الفشل والإلغاء وartifact المنتهي يمنعون النشر.
3. رفض مصدر تحرك عنه رأس الفرع أو دليل يعود إلى PR/fork/محاولة قديمة.
4. احترام GitHub Environment، ثم إعادة التحقق من المصدر.
5. pull للمشروع الحالي وبيئته، والتحقق من ID وroot وVITE variables
   وربط دومين الواجهة بالمشروع والبيئة المستهدفة.
6. فحص API source/readiness/CORS ورفض anonymous /auth/me، دون تعديل بيانات.
7. كتابة deployment.json من SHA المحدد، ثم build مرة واحدة.
8. رفع prebuilt؛ الإنتاج يستخدم `--prod --skip-domain` ليبقى الدومين
   على الإصدار السابق إلى نجاح الفحوص.
9. فحص metadata وCSP وSPA deep links على artifact، وإعادة فحص API والمصدر.
10. promote للإنتاج أو alias set لـstaging، ثم فحص الدومين الفعلي.

قد يطبق Vercel branch alias لـstaging أثناء upload إذا كان branch tracking
مفعّلًا؛ ضمان تأجيل نقل الدومين حتى smoke يخص staged production.

لا ترفع .vercel كـartifact؛ يحتوي قيم env المسحوبة. يتجاهله Git وتنظفه
الخطوة النهائية. لا ينشر المسار logs خامًا تحتوي استجابات API.

النجاح يثبت **HTTP deployment smoke** فقط. لا يثبت وحده login/OTP،
refresh/logout، رفع هوية، فحص ClamAV، موافقة Admin، booking أو WSS
مصادقًا عليه. شغّل رحلات القبول الحقيقية على الدومين الثابت ببيانات
اختبار قبل إعلان المنصة جاهزة للعملاء.

## 9. أول تشغيل وإعادة المحاولة

بعد الدمج والإعداد وصحة API يبدأ النشر مع push الموافق. لإعادة المحاولة
بعد تصحيح إعداد أو إعادة check فاشل، افتح Actions → Vercel continuous
delivery → Run workflow:

- Branch=develop وTarget=staging، أو Branch=main وTarget=production.
- source_sha هو SHA الكامل لرأس الفرع الذي اجتاز فحوص push.

أو من GitHub CLI المصادق:

```bash
gh workflow run cd-vercel.yml --repo baraabd/homeservicemarketplace \
  --ref develop -f target=staging -f source_sha=FULL_CURRENT_DEVELOP_SHA
```

استبدل FULL_CURRENT_DEVELOP_SHA بالقيمة الحقيقية.
إذا انتهت صلاحية artifacts القديمة، أعد الفحوص للحصول على أدلة حديثة.

## 10. الرجوع وإيقاف النشر

قبل promote يبقى production domain كما كان. إن فشل فحص الدومين بعده،
أو انتهت مهلة promote، افحص Current Deployment وpromotion status قبل
إعادة المحاولة؛ قد يستمر promote في الخلفية. ارجع إلى artifact معروف
ومتوافق مع API/schema. لا تخمّن deployment السابق ولا تعكس migrations آليًا.

لإيقاف CD مؤقتًا استخدم Disable workflow في GitHub للملف الجديد؛ لا
تغيّر فحوص الأمان ولا تفعّل نشر Git موازيًا.

## مراجع رسمية

- [GitHub Actions مع Vercel](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)
- [Monorepos](https://vercel.com/docs/monorepos)
- [Environments](https://vercel.com/docs/deployments/environments)
- [Environment variables](https://vercel.com/docs/environment-variables)
- [CLI pull](https://vercel.com/docs/cli/pull)
- [CLI deploy](https://vercel.com/docs/cli/deploy)
- [Promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment)
- [Project domain API](https://vercel.com/docs/rest-api/projects/get-a-project-domain)
- [Public Suffix List](https://publicsuffix.org/list/)
- [Railway pre-deploy](https://docs.railway.com/deployments/pre-deploy-command)
