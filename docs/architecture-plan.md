# منصة عائلة أبو جامع — Corrected Architecture Plan

> **المراجعة النهائية قبل التنفيذ (Final Pre-Implementation)** — هذا الإصدار يتضمن كل تصحيحات الـSchema والمعمارية النهائية. التفاصيل الكاملة للقيود في `docs/database-schema.md`.

## قرار الـStack
بعد المراجعة، تم اعتماد الاستمرار على:
- Next.js (App Router)
- Drizzle ORM
- PostgreSQL

**السبب**: هذا هو المشروع الفعلي القائم حاليًا. التحويل إلى Laravel الآن سيرفع المخاطر ويؤخر التسليم دون فائدة مباشرة في مرحلة تصحيح المعمارية والـSchema.

---

## المبادئ المعمارية الأساسية
1. Database-first + Security-first.
2. لا توجد صلاحية تعتمد على الواجهة فقط.
3. عزل البيانات حسب الدور والنطاق (Role + Scope).
4. جميع العمليات الحساسة يجب أن تكون عبر Transactions مع Audit.
5. البيانات الحساسة لا تظهر ولا تُخزّن في Logs العامة.
6. كل قاعدة لا يمكن لقاعدة البيانات فرضها (cross-table أو زمنية متغيرة) لها مالك صريح في طبقة الخدمة — موثقة في "مصفوفة الإنفاذ" بـ`docs/database-schema.md`.

---

## نموذج الهوية (Identity Model)
تم اعتماد جدول مركزي:
- `people`

ويحمل:
- `national_id` فريد على مستوى النظام بالكامل.

وتشير إليه الجداول التالية:
- `users.person_id`
- `family_members.person_id`
- `family_profiles.head_person_id`

بهذا لا يمكن تمثيل الشخص نفسه كسجلين منفصلين داخل النظام.

### سياسة الهاتف (نهائية)
- `people.phone` (الأساسي) **nullable** على مستوى البيانات — ليس كل فرد أسرة يملك هاتفًا.
- `secondary_phone` يبقى nullable.
- عند إدخال أي منهما: **10 أرقام بالضبط** (`^[0-9]{10}$`) — مفروض بـCHECK على مستوى DB.
- **يُمنع تخزين الهاتف كـinteger** — دائمًا `varchar`.
- **هاتف Family Head الأساسي مطلوب**، ويُفرض على مستوى **Registration/Service validation** فقط (شرط "رب الأسرة" يعيش في `family_profiles` — جدول آخر — ولا يمكن لـCHECK في PostgreSQL عبور الجداول). لا تعد وتضيف `NOT NULL` على العمود.
- متطلبات Family Head نفسها لم تتغير.

---

## نموذج المستخدمين والحسابات — توافق النوع والدور (Canonical)

`users` يمثل حساب الدخول فقط، مفصولًا عن نموذج الشخص.

**الشكل القانوني الوحيد:**

### Family Head
```text
account_type = family_head
auth_method  = national_id
role         = family_head
person_id    != null
username     = null
```

### Administrative
```text
account_type = administrative
auth_method  = username
username     يبدأ بـ admin-
role ∈ { branch_admin, publisher, admin, general_manager }
```

### ممنوع معماريًا
```text
حساب family_head    + دور إداري
حساب administrative + دور family_head
دور guest على أي صف users (الضيف بلا حساب)
```

### حدود الإنفاذ (موثقة بقصد)
- **تفرضه قاعدة البيانات** (same-row CHECKs): `family_head → national_id + person_id`؛ `administrative → username + بادئة admin-`؛ `family_head → username IS NULL`.
- **لا تفرضه قاعدة البيانات**: توافق `account_type ↔ role` قاعدة **عبر الجداول** (`users.role_id → roles.code`)، وCHECK في PostgreSQL لا يشير لجدول آخر، ولا ننسخ `role_code` داخل `users` (ازدواج تمثيل). **يُفرض في Service/Domain transaction** عند أي إنشاء/تعديل حساب — ملزم لأي تنفيذ مستقبلي.

### RBAC
الأدوار المعتمدة: Guest / Family Head / Branch Admin / Publisher / Admin / General Manager — مخزّنة عبر `roles`, `permissions`, `role_permissions`, `users.role_id`.

---

## نموذج العائلة والأفراد — ملكية Family Head

- `family_profiles` لبيانات الأسرة، و**`family_profiles.head_person_id` هو تمثيل Family Head**.
- `family_members` لربط الأشخاص بالأسرة وصلة القرابة — **ولا يشمل الـHead**.
- الزوجات لا يوجَد لهن جدول منفصل (`family_wives` غير موجود).

### قاعدة الملكية القاطعة (منع الازدواج)
تمثيل الشخص داخل أسره يحدث **مرة واحدة بالضبط**: إما Head (`family_profiles.head_person_id`) أو Member (صف واحد في `family_members`) — **وليس الاثنين أبدًا**.

- **Family Head لا يحتاج سجلًا إضافيًا في `family_members` لمجرد كونه Head.**
- أي تنفيذ مستقبلي **يُمنع** من إنشاء تمثيل domain مكرر لنفس الشخص (صف member للـhead، أو head + member معًا ولو عبر أسرتين).
- الاستثناءية (XOR) عبر جدولين → لا يمكن CHECK في PostgreSQL → تُفرض في معاملة الخدمة: قفل صف `people` (`SELECT ... FOR UPDATE`) ثم التحقق من عدم وجود تمثيل متعارض قبل أي إدراج.

### قاعدة 4 زوجات
مدعومة تصميميًا في قاعدة البيانات عبر:
- `wife_ordinal` محصور بين 1 و4 فقط عند `relationship='wife'`.
- `UNIQUE (family_profile_id, wife_ordinal)` جزئي للزوجات.

هذا يمنع إدخال الزوجة الخامسة على مستوى DB (تحتاج رقمًا خامسًا أو رقمًا مشغولًا — كلاهما مرفوض).

**استراتيجية الـrace condition (ملزمة للتنفيذ):** التخصيص التلقائي لـ`wife_ordinal` داخل Transaction مع قفل صف `family_profiles` (`FOR UPDATE`)، مع قراءة الأرقام المشغولة واختيار رقم حر (يسمح بإعادة استخدام رقم متحرر)، والـunique index يعمل كـbackstop — أي سباق ينهار إلى 23505 فتعيد الخدمة المحاولة.

---

## Request / Approval Architecture
### Registration Request
`draft -> submitted -> pending -> approved/rejected`

### Member Request
`pending -> approved/rejected`

### Modification Request
`pending -> approved/rejected`

كل طلب يحمل: requester / branch / status / reviewer / reviewed_at / reason/note، مع CHECKs اتساق (reviewer+reviewed_at عند الحسم، وrejection_reason عند الرفض).

---

## عزل البيانات (Scope Enforcement) — موثق صراحة
- **Branch Admin: نطاقه فرعه فقط** — كل استعلام/كتابة يفلتر server-side بـ`branch_id` الخاص بالحساب. لا يعتمد أبدًا على فلترة الواجهة.
- **Family Head: نطاقه أسرته** — كل وصول لبيانات الأسرة/الطلبات/الإشعارات يفلتر بملكية `family_profiles.head_person_id = current person_id` (ownership-bound server-side). لا يمكن لرب أسرة قراءة/تعديل أسرة أخرى.
- **Publisher/Admin/General Manager: نطاقاتها المركزية** — النشر والإدارة العليا وإدارة الحسابات الإدارية.
- الملفات الشخصية الحساسة (هوية/هاتف/صحة) خلف Auth + Authorization + Ownership دائمًا.

---

## الانتهاء التلقائي للمحتوى (Automatic Expiration) — Architecture

حقيقة قاطعة: **`expire_at` لا يجعل PostgreSQL يغيّر الـstatus تلقائيًا.** لا يمر زمني يعدّل الصفوف، ولا trigger موجود. التصميم من قطعتين:

1. **الاستعلام العام (منذ اليوم الأول — لا يعتمد على أي job):**
```sql
status = 'published'
AND (expire_at IS NULL OR expire_at > NOW())
```
   (الأقواس إلزامية — `AND` أسبق من `OR`؛ مع `deleted_at IS NULL` على مستوى الخدمة.)

2. **Scheduled Job لاحق (غير منفذ الآن):** ينقل `published → expired` عند `expire_at <= now()` كتصحيح دلالي/أرشفة. حتى قبل تشغيله، المحتوى المنتهي غير ظاهر للعامة بفضل مسار الاستعلام.

الفهارس الجزئية `news_public_expiry_idx` و`announcements_public_expiry_idx` تخدم الاستعلام العام والـJob معًا.

---

## Audit & Sensitive Data Architecture
- `audit_logs` يسجّل (من؟ ماذا؟ متى؟ على أي سجل؟ قبل/بعد) مع IP/User-Agent — سجل append-only للعمليات الحساسة (اعتماد الطلبات، تعديل بيانات، إدارة الحسابات، أحداث OTP دون الرمز أو الهاش).
- `registration_request_attachments` تخزن `visibility='private'` افتراضيًا، مع whitelist للنوع/الحجم/العدد مفروضة بـCHECK.
- البيانات الحساسة (هوية/هاتف/صحة) ضمن نموذج وصول مقيد (Auth + Authorization + Ownership)، ولا تُكمل National IDs في الواجهات العامة ولا في الـlogs.
- الـOTP يُخزن hashed فقط (`otp_hash`) — أبدًا لا يُخزن الرمز الخام.

---

## OTP Architecture — تصميم "التحدي الحالي" (Schema-ready)
**صف واحد بالضبط لكل `(phone, purpose)`** عبر `UNIQUE(phone, purpose)` — لا فريد جزئي.

لماذا: التحدٍ المنتهي الصلاحية يبقى `consumed_at = NULL` فيحجز فريدًا جزئيًا ويمنع إصدار OTP جديد. الـUNIQUE الكامل يستحيل ذلك.

**Resend = تحديث واحد لنفس الصف:** otp_hash جديد، expires_at جديد، تصفير attempts، تحديث last_sent_at، زيادة resend_count، تصفير consumed_at، وتصفير locked_until عند سماح سياسة الـresend. الإصدار عند غياب الصف = INSERT، وأي سباق ينهار إلى 23505 → إعادة محاولة.

يبقى OTP (هيكل أعمدة الآن؛ الإنفاذ منطق خدمة لاحقًا): **hashed / single-use / expiring / attempt-limited / rate-limited / lockable**.

لا يُحتفظ بتاريخ OTP بقصد — أحداث دورة الحياة (دون الرمز/الهاش) تذهب لـ`audit_logs`؛ لا يُضاف جدول history إلا لحاجة امتثال صريحة.

**لم يُنفذ OTP service الآن.**

---

## Import/Export Architecture
- `import_export_batches` + `import_errors` مع دعم branch scope / operation type / status / audit-ready metadata.

---

## ملاحظة حول CHECK Constraints
تم تجنب استخدام `CURRENT_DATE/NOW()` في CHECK الخاصة بالمنطق الزمني المتغير (مثل منع تاريخ مستقبلي) لأن هذا النوع ليس خيارًا موثوقًا معماريًا كقيد دائم — والتحقق الزمني المتغير يُفرض على مستوى Validation/Service وقت الكتابة.

كذلك تم تجنب أي محاولة CHECK cross-table (غير قابلة للتنفيذ في PostgreSQL أصلًا) — القواعد العابرة للجداول (توافق النوع/الدور، Head XOR Member) موثقة بمالك إنفاذ صريح في طبقة الخدمة.

---

## الحالة الحالية — حدود هذه المرحلة
تم إنجاز: Architecture + Schema + RBAC modeling (schema فقط).

**لم يبدأ بعد (مقصود):** UI / API / Auth / Registration / OTP service / Dashboard / CRUD / Notifications / File upload / Scheduled jobs.
