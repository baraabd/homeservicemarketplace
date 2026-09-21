# دليل التشغيل والتفعيل — إغلاق Sprint 12

الغرض: إعادة إنتاج البناء والتشغيل المُتحقَّق منهما محليًا، بلا أسرار، وبما
يفصل **الاختبار** عن **التفعيل الإنتاجي**.

> **هذا الدليل لا يُفعِّل شيئًا في الإنتاج.** كل ما فيه بيئة معزولة قابلة
> للإتلاف. التفعيل يحتاج موافقات Product/Security/Privacy التي لم تُطلب ولم
> تُمنح.

---

## 1. الخدمات المعزولة

منافذ عابرة، ولا تلمس خدمات المستخدم على 5432/6379/4000:

```bash
docker compose -p hsm-int-20260920 \
  -f infra/docker/docker-compose.integration.yml up -d
docker compose -p hsm-int-20260920 -f infra/docker/docker-compose.integration.yml port postgres 5432
docker compose -p hsm-int-20260920 -f infra/docker/docker-compose.integration.yml port redis 6379
docker compose -p hsm-int-20260920 -f infra/docker/docker-compose.integration.yml port mailpit 8025
```

في الجلسة الموثَّقة: postgres `59877`، redis `59880`، mailpit HTTP `59878`،
SMTP `59879`.

---

## 2. القاعدة

```bash
DATABASE_URL="postgresql://hsm_it:hsm_it_local_only@127.0.0.1:59877/hsm_phase2_it?schema=public" \
  pnpm --filter @homeservicemarketplace/database exec prisma migrate deploy
pnpm --filter @homeservicemarketplace/database generate   # ضروري في شجرة جديدة
```

`prisma migrate status` = **60 ترحيلًا، up to date**.

---

## 3. مفاتيح الإعداد المطلوبة (بلا قيم سرية)

`.env` في جذر الشجرة (مُستبعد من Git). القيم الحسّاسة تُولَّد محليًا:

```
NODE_ENV, DATABASE_URL, PORT=4022
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET   # ولِّدها: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_ISSUER, JWT_AUDIENCE
REDIS_HOST, REDIS_PORT                  # ← ليس REDIS_URL
SMTP_HOST, SMTP_PORT
VERIFICATION_ENFORCED=true, WORK_ACCESS_ENFORCED=true
STORAGE_DRIVER=local
COOKIE_SECURE=false, COOKIE_SAMESITE=lax
CORS_ORIGINS=http://127.0.0.1:4190,http://localhost:4190
AUTH_REGISTER_THROTTLE_LIMIT=200
AUTH_OTP_VERIFY_THROTTLE_LIMIT=400
GLOBAL_THROTTLE_LIMIT=5000
```

> ⚠️ **مزلقان مثبتان تجريبيًا**
>
> 1. **`REDIS_URL` مفتاح غير معترف به.** المخطط يقرأ `REDIS_HOST`/`REDIS_PORT`
>    فقط. استخدامه يجعل الـAPI يعود صامتًا إلى `localhost:6379` — أي Redis
>    المستخدم — فتتسرّب حالة الاختبار خارج العزل.
> 2. **حدود الـthrottle الثلاثة أعلاه منسوخة عن `ci.yml`** لوظائف الاختبار،
>    لا اختراعًا. الافتراض الإنتاجي (5 تسجيلات/ساعة/IP) يُسقط أي حزمة طويلة،
>    ويُسجَّل الحظر في Redis لمدة ساعة فلا يزول برفع الحد لاحقًا. الإنتاج
>    يرفض الإقلاع بقيم أوسع.

---

## 4. البناء والتشغيل

```bash
pnpm install --frozen-lockfile
VITE_API_URL=http://127.0.0.1:4022 pnpm --filter @homeservicemarketplace/web build
pnpm --filter @homeservicemarketplace/api build

# الـAPI
node apps/api/dist/main.js            # من apps/api ليجد ../../.env

# الويب المبني
node apps/web/node_modules/vite/bin/vite.js preview \
  --host 127.0.0.1 --port 4190 --strictPort
```

`VITE_API_URL` **إلزامي** لبناء الإنتاج: حارس fail-closed يرفض البناء بدونه بدل
أن يُخبز `localhost:4000` صامتًا في الحزمة.

---

## 5. إثبات أن المخدوم هو ما بُني

```bash
curl -s http://127.0.0.1:4190/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
curl -s http://127.0.0.1:4190/assets/<bundle>.js | sha1sum
sha1sum apps/web/dist/assets/<bundle>.js     # يجب أن يتطابقا
```

في الجلسة الموثَّقة: `index-_PjgojJC.js`، sha1
`408773c433e2e196879a3e38c1054431524cadf5` على الطرفين.

---

## 6. الرايات — ما يراه المستخدم فعلًا

| الراية                         | الافتراضي           | الأثر                                                                                        |
| ------------------------------ | ------------------- | -------------------------------------------------------------------------------------------- |
| `VITE_DISPUTE_INTAKE_V1`       | **false**           | راية **تنقّل** فقط: تُظهر مدخل النزاع على الحجوزات. لا تمنح وصولًا ولا تُفعِّل سياسة الخادم. |
| `disputes.self_service.intake` | **غير مبذور**       | سياسة الخادم. غيابها أو تعطّلها يمنع أي إنشاء جديد. لا توجد فئة wildcard.                    |
| تبويبات الأدمن (هذا الفرع)     | **بلا راية**        | تغيير عرضٍ على مسار أدمن قائم. لا تمنح صلاحية ولا تغيّر أمرًا. المشارك لم يتغيّر.            |
| عامل الصيانة                   | **معطّل افتراضيًا** | shadow يقرأ العدادات فقط؛ الإنفاذ يحتاج مفاتيح وماسحًا وتخزينًا وسياسة صريحة.                |

---

## 7. التراجع

تبويبات الأدمن: استرجاع commit `65eeff1` وحده يكفي. لا ترحيل، ولا عقد، ولا
سياسة، ولا راية — لا شيء يحتاج تراجعًا في البيانات.

بقية Sprint 12: التراجع بسحب سياسة التجربة وراية التنقّل؛ **لا تُمحى القضايا
ولا يُزال قيد منع التكرار** — ذلك ليس تراجعًا عن ميزة.

---

## 8. التنظيف

```bash
docker compose -p hsm-int-20260920 -f infra/docker/docker-compose.integration.yml down   # بلا -v
```

أوقف فقط العمليات التي بدأتها أنت (المنفذان 4022 و4190 هنا). لا تُنهِ عملية
مجهولة ولا حاوية غير تابعة لك.
