# إعداد واتساب OTP محليًا وعلى Railway

Delivery mode: **Mode A — Integration and Bug-Fix**. This guide covers provider configuration and verification; it does not certify a live delivery or change the selected authentication channel.

## لماذا تظهر «التحقق عبر واتساب غير متاح مؤقتًا»؟

تقرأ الواجهة `GET /v1/auth/config`. عندما تكون `whatsappAvailable=false` فإن إعدادات مزوّد الإرسال المحدد غير مكتملة. إضافة مفتاح GREEN-API إلى متغير يحمل اسم Meta لن تجعل الإعدادات صالحة؛ يجب اختيار المزوّد المطابق للحساب.

| بيانات الحساب التي لديك                                                   | قيمة `WHATSAPP_PROVIDER` | الإعدادات المطلوبة                                          |
| ------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| GREEN-API: `apiUrl` و`idInstance` و`apiTokenInstance`                     | `greenapi`               | `GREEN_API_URL` و`GREEN_API_ID_INSTANCE` و`GREEN_API_TOKEN` |
| Meta WhatsApp Cloud API: Access Token وPhone Number ID وقالب مصادقة معتمد | `meta`                   | متغيرات `WHATSAPP_*` الموضحة أدناه                          |

`WHATSAPP_PROVIDER` يختار جهة إرسال واتساب. إعداد المنصة المحفوظ `auth.otpChannel` يختار قناة المصادقة، واتساب أو البريد. عند عدم حفظ قناة صراحةً، يكون الافتراضي واتساب. إذا كانت القناة المحفوظة بريدًا، تظل كذلك حتى يغيرها مسؤول مؤهل من الإعدادات.

`whatsappAvailable=true` يعني اكتمال إعدادات المزوّد في الخادم. لا يفحص هذا الحقل صلاحية المفتاح لدى المزوّد، أو الاتصال الحي، أو وصول الرسالة.

## 1. مكان المفاتيح في التشغيل المحلي

شغّل الأوامر من **جذر المستودع** باستخدام إصدار Node وpnpm المثبتين للمشروع. أبقِ إعدادات قاعدة البيانات والخدمات الموجودة كما هي، وأضف إعدادات واتساب إلى ملف API محلي غير متتبع.

في PowerShell:

```powershell
if (!(Test-Path "apps/api/.env.local")) {
    New-Item -ItemType File "apps/api/.env.local" | Out-Null
}
notepad "apps/api/.env.local"
```

هذا ينشئ الملف فقط إذا لم يكن موجودًا. لا تستبدل ملف إعداداتك الحالي بنسخة فارغة. عند وجود متغير بالاسم نفسه في الملف، عدّل قيمته بدل تكرار المفتاح.

ترتيب أولوية الإعدادات عند تشغيل API بأوامر pnpm هو:

1. متغيرات بيئة العملية الحالية أو الاستضافة.
2. `apps/api/.env.local`.
3. `apps/api/.env`.
4. `.env.local` في جذر المستودع.
5. `.env` في جذر المستودع.

لهذا قد لا يؤثر تعديل ملف الجذر إذا كانت قيمة مختلفة موجودة في ملف API أو بيئة الطرفية. ملفات `.env.local` مستثناة من Git. لا تضف الأسرار إلى `.env.example`، ولا تضعها في `apps/web` أو متغيرات `VITE_*` أو `NEXT_PUBLIC_*`.

## 2. إعداد GREEN-API

من صفحة **الـInstance نفسه** في لوحة GREEN-API، انسخ القيم التالية إلى الملف المحلي:

```dotenv
WHATSAPP_PROVIDER=greenapi
GREEN_API_URL=https://7107.api.greenapi.com
GREEN_API_ID_INSTANCE=YOUR_ID_INSTANCE
GREEN_API_TOKEN=YOUR_API_TOKEN_INSTANCE
WHATSAPP_REQUEST_TIMEOUT_MS=10000
```

استبدل `YOUR_ID_INSTANCE` و`YOUR_API_TOKEN_INSTANCE` بقيم حسابك. عنوان `7107` هنا مثال؛ استخدم `apiUrl` المعروض للـInstance الذي اخترته. `mediaUrl` غير مطلوب لإرسال OTP نصي. معرّف الـInstance ليس رقم هاتف واتساب.

لا تضف مسار `waInstance...` أو `/sendMessage/...` إلى `GREEN_API_URL`: القيمة المطلوبة أصل HTTPS فقط. يقبل التطبيق نطاقات API الخاصة بـGREEN-API، ويرفض العناوين الخارجية والمسارات وبيانات المستخدم والاستعلامات. يتولى الكود تركيب الطلب، ويحجب المفتاح عن السجلات.

إذا كانت صورة أو محادثة سابقة قد كشفت المفتاح، دوّره من لوحة المزوّد ثم ضع المفتاح الجديد في إعدادات الخادم. لا تنشره في Git أو في طلب مراجعة أو لقطة شاشة جديدة.

### تحديد نوع الـInstance

لـGREEN-API خدمة مرتبطة بتطبيق واتساب/الأجهزة، وخدمة **WABA**. صيغة `sendMessage` وحدها لا تحدد نوع الحساب؛ راجع نوع الـInstance في لوحة المزوّد.

- **Instance مرتبط بالأجهزة:** أكمل الربط بالطريقة التي تعرضها لوحة المزوّد، وتحقق من حالة `authorized`. اترك `GREEN_API_AUTH_TEMPLATE_ID` غير معرف؛ يستخدم المزوّد رسالة نصية تتضمن الرمز.
- **GREEN-API WABA:** جهز قالبًا معتمدًا من فئة `AUTHENTICATION`، ثم أضف معرّفه الذي يعيده GREEN-API:

```dotenv
GREEN_API_AUTH_TEMPLATE_ID=YOUR_APPROVED_TEMPLATE_ID
```

وجود هذا المتغير يختار `sendTemplate`. القيمة معرّف قالب GREEN-API، وليست اسم قالب Meta. غيابه لا يكشف نوع الحساب تلقائيًا؛ لا تتركه فارغًا إذا كان حساب WABA يحتاج إرسال قالب المصادقة. لا يلزم ضبط `WHATSAPP_AUTH_TEMPLATE_APPROVED=true` لحساب GREEN-API؛ هذا العلم يخص المزوّد المباشر لـMeta.

## 3. إعداد Meta WhatsApp Cloud API

استخدم هذا القسم إذا كانت بياناتك صادرة من Meta مباشرة. قيم GREEN-API لا تصلح بدل Access Token أو Phone Number ID الخاصين بـMeta.

```dotenv
WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=YOUR_META_SYSTEM_USER_TOKEN
WHATSAPP_PHONE_NUMBER_ID=YOUR_META_PHONE_NUMBER_ID
WHATSAPP_GRAPH_API_VERSION=YOUR_SUPPORTED_GRAPH_API_VERSION
WHATSAPP_AUTH_TEMPLATE_NAME=YOUR_APPROVED_TEMPLATE_NAME
WHATSAPP_AUTH_TEMPLATE_LANGUAGE=ar
WHATSAPP_AUTH_TEMPLATE_APPROVED=true
WHATSAPP_REQUEST_TIMEOUT_MS=10000
```

استبدل جميع القيم التوضيحية. اختر إصدار Graph API مدعومًا بصيغة `vNN.N` من إعدادات Meta وتوثيقها الحالي. اسم القالب الفعلي يجب أن يكون بالأحرف الصغيرة/الأرقام/الشرطة السفلية، واللغة يجب أن تطابق نسخة القالب المعتمدة.

يلزم رقم إرسال مسجل، ومفتاح مخول بـ`whatsapp_business_messaging`، وقالب **AUTHENTICATION / COPY_CODE** يقبل الرمز في النص وزر نسخ الرمز. اضبط انتهاء القالب بما يطابق صلاحية التطبيق، خمس دقائق. `WHATSAPP_AUTH_TEMPLATE_APPROVED=true` إقرار منك بأن Meta وافقت على القالب؛ كتابة `true` لا تنشئ القالب ولا تعتمد حسابك لدى Meta.

إذا استخدمت رقم الاختبار من Meta، أكمل متطلبات إضافة المستلم والتحقق منه في لوحة Meta قبل اختبار الإرسال. للإنتاج استخدم بيانات رقم الإرسال الفعلي ومفتاحًا مناسبًا للخادم، مع إدارة صلاحيته وتجديده.

## 4. الفحص وإعادة التشغيل

افحص الإعدادات المحلية أولًا:

```powershell
node scripts/dev/whatsapp-doctor.cjs
```

يعرض الأمر أسماء المتغيرات الناقصة أو غير الصحيحة دون قيمها. لا يرسل رسالة، ولا يغير قاعدة البيانات، ولا يعدل الملفات أو قناة المصادقة. نجاحه يخص إعدادات واتساب المحددة فقط؛ تظل بقية إعدادات تشغيل API خاضعة لتحقق التطبيق عند الإقلاع.

مع GREEN-API فقط، يوجد فحص اتصال اختياري للقراءة:

```powershell
node scripts/dev/whatsapp-doctor.cjs --check-connection
```

يرسل هذا الأمر طلب `GET getStateInstance` واحدًا إلى المزوّد. النجاح المتوقع `authorized`. لا يرسل OTP ولا يعيد ربط الحساب أو يغير إعداداته. لا يطبع الرابط المحتوي على المفتاح أو رسالة الخطأ الخام من المزوّد. إذا انتهى بمهلة أو ظهرت حالة غير مخولة، تحقق من لوحة GREEN-API والاتصال بالشبكة.

بعد تغيير متغيرات البيئة، أوقف API الجاري ثم شغله من جديد:

```powershell
pnpm --filter @homeservicemarketplace/api dev
```

وشغّل الواجهة في طرفية أخرى إن لم تكن تعمل:

```powershell
pnpm --filter @homeservicemarketplace/web dev
```

افتح إعدادات المصادقة العامة. المثال التالي يفترض `PORT=4000`؛ بدّل `4000` إلى قيمة API عندك، مثل `4010`:

```powershell
Invoke-RestMethod "http://localhost:4000/v1/auth/config"
```

إذا كانت قناة المنصة المختارة واتساب واكتملت إعدادات المزوّد، تكون القيم:

```json
{
  "otpChannel": "whatsapp",
  "whatsappAvailable": true
}
```

أعد تحميل صفحة التسجيل بعد إعادة تشغيل API. إذا ظلت النتيجة `false`، افحص أولوية الملفات والمتغيرات و`WHATSAPP_PROVIDER`. إذا كانت النتيجة `otpChannel: "email"`، فهناك اختيار بريد محفوظ؛ غيّره من لوحة مسؤول له رقم واتساب متحقق منه، مع الحفاظ على طريقة دخول المسؤول الموجودة. لا تمسح إعداد القناة أو تعدل قاعدة البيانات يدويًا لتجاوز التحقق.

## 5. إضافة القيم على Railway

انشر أولًا نسخة API التي تحتوي على دعم المزوّد المطلوب، ثم افتح مشروع الخدمات المنزلية والبيئة الصحيحة (`staging` أو `production`)، واختر **خدمة API** ثم **Variables**.

أضف الأسماء والقيم نفسها من قسم GREEN-API أو Meta. قيمة الحقل تكون النص نفسه، دون كتابة اسم المتغير داخل القيمة ودون إضافة علامات اقتباس للسر. ضع المفتاح في متغير سري/محمي متى أتاحت إعدادات الخدمة ذلك. طبّق تحديث البيئة ونشر API وفق إجراءات النشر المعتمدة، ثم تحقق من `/v1/auth/config` على عنوان API المنشور.

هذه مفاتيح Backend. لا تضفها إلى مشروع الواجهة في Vercel. الواجهة تحتاج عنوان API العام في `VITE_API_URL`، لكنها لا تحتاج مفتاح واتساب أو معرّف حساب الإرسال. تغيير Vercel وحده لا يعدل إعدادات API على Railway.

افصل بيانات الاختبار عن الإنتاج حيث أمكن. لا تحذف SMTP عند تفعيل واتساب: إعداد البريد ما زال مطلوبًا لتشغيل الإنتاج وللوظائف الأخرى التي تعتمد عليه.

## 6. اختبار قبول فعلي

استخدم رقم مستلم آخر مسجلًا بواتساب، مختلفًا عن رقم حساب الإرسال، ومسموحًا باختباره. ثم نفّذ من واجهة التطبيق:

1. التسجيل أو تسجيل الدخول وطلب الرمز.
2. وصول رسالة الرمز إلى الهاتف خلال مدة صلاحيته.
3. إدخال الرمز الصحيح مرة واحدة وإكمال العملية.
4. التأكد من رفض الرمز الخاطئ، والرمز الذي استُخدم، والرمز المنتهي.
5. إعادة الإرسال من الواجهة والتحقق من حدودها، ثم اختبار الاستعادة إذا كانت ضمن الإطلاق.

الرمز في التطبيق من ستة أرقام وصالح لخمس دقائق. نجاح طلب المزوّد أو حصوله على `idMessage` يعني قبول الإرسال، ولا يثبت الاستلام. قد تحتفظ GREEN-API برسائل في طابورها عند انقطاع التفويض؛ لهذا يفحص النقل حالة الحساب قبل الإرسال، وتظل صلاحية التحدي مفروضة من التطبيق حتى لو وصلت الرسالة متأخرة. الفحص المسبق لا يضمن استمرار الاتصال بعده.

## مراجع

- [قراءة ملفات إعدادات API](../../apps/api/src/config/config.module.ts)
- [سياسة قناة المصادقة](../../apps/api/src/infrastructure/auth-channel/auth-channel.service.ts)
- [إعدادات المزوّد](../../apps/api/src/config/env.schema.ts)
- [خدمة OTP وحدود الرمز](../../apps/api/src/modules/iam/authentication/services/otp.service.ts)
- [GREEN-API: حقول الوصول إلى الـInstance](https://green-api.com/en/docs/before-start/)
- [GREEN-API: حالة التفويض](https://green-api.com/en/docs/api/account/GetStateInstance/)
- [GREEN-API: إرسال الرسائل](https://green-api.com/en/docs/api/sending/SendMessage/)
- [GREEN-API WABA: إرسال القوالب](https://green-api.com/en/waba/docs/api/sending/SendTemplate/)
- [Meta: قوالب المصادقة](https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/)
