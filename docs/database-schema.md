# Database Schema Documentation — منصة عائلة أبو جامع

> المصدر الوحيد للحقيقة (Single Source of Truth) للـSchema هو `src/db/schema.ts`.
> هذا الملف يوثّق القرارات، القيود، وحدود ما يُفرض على مستوى قاعدة البيانات مقابل ما يُفرض على مستوى الخدمة (Service Layer).

**آخر تحديث:** المراجعة النهائية قبل التنفيذ (Final Pre-Implementation Corrections).

---

## نظرة عامة والاصطلاحات

- PostgreSQL 15+ مع Drizzle ORM.
- المعرفات: `uuid` للكيانات، `serial` للجداول المرجعية (branches/roles/permissions).
- كل الطوابع الزمنية `timestamp with time zone`.
- الحذف الناعم (Soft delete) عبر `deleted_at` في جداول المحتوى (news/announcements/archive).
- لا توجد أي CHECK Constraint تعتمد على زمن متغير (`NOW()` / `CURRENT_DATE` / `CURRENT_TIMESTAMP`) — هذا النوع من القيود غير موثوق في PostgreSQL ولا يُستخدم هنا. كل منطق التحقق الزمني المتغير يحدث في طبقة الخدمة وقت الكتابة.

---

## جداول الهوية (Identity)

### `people` — الهوية المركزية للشخص

الجدول المرجعي الوحيد للشخص. `national_id` فريد عالميًا (`people_national_id_uidx`)، وتشير إليه:

- `users.person_id`
- `family_profiles.head_person_id`
- `family_members.person_id`
- `announcements.related_person_id`

بهذا لا يمكن تمثيل الشخص نفسه بأكثر من سجل هوية.

#### سياسة الهاتف (النهائية)

| العمود | الإلزامية | التنسيق عند الإدخال |
|---|---|---|
| `phone` (الأساسي) | **nullable** — ليس كل فرد أسرة يملك هاتفًا | `^[0-9]{10}$` بالضبط |
| `secondary_phone` | nullable | `^[0-9]{10}$` بالضبط |

القيود:

```sql
CONSTRAINT people_phone_format_chk CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$');
CONSTRAINT people_secondary_phone_format_chk CHECK (secondary_phone IS NULL OR secondary_phone ~ '^[0-9]{10}$');
```

قواعد صريحة:

1. **لا يُخزن الهاتف أبدًا كـ integer** — يُخزن `varchar(10)` للحفاظ على الأصفار البادئة و دلالة التنسيق.
2. هاتف Family Head الأساسي **مطلوب**، لكن على مستوى **Registration/Service validation فقط**: كون الشخص "رب أسرة" معلومة تعيش في `family_profiles` (جدول آخر)، وCHECK في PostgreSQL لا يمكنه عبور الجداول. **لا تعد وأضف `NOT NULL`** — سيكسر أفراد الأسرة غير الرؤساء.
3. متطلبات Family Head نفسها لم تتغير.

### `users` — حساب الدخول فقط

مفصول تمامًا عن نموذج الشخص. راجع "مصفوفة توافق نوع الحساب والدور" أدناه.

### `family_profiles` / `family_members` — الأسرة

- `family_profiles.head_person_id` **هو تمثيل Family Head**.
- Family Head **لا يحتاج** سجلًا إضافيًا في `family_members` لمجرد كونه Head.
- قاعدة الملكية القاطعة: تمثيل الشخص داخل أسره يحدث **مرة واحدة بالضبط** — إما Head (في `family_profiles`) أو Member (صف واحد في `family_members`)، **وليس الاثنين أبدًا**.

قيود DB الموجودة:

- `family_profiles_head_person_uidx`: شخص واحد = رب أسرة واحدة كحد أقصى.
- `family_members_person_uidx`: الشخص يظهر كـ member في أسرة واحدة كحد أقصى (عالميًا).
- `family_members_wife_slot_uidx` (جزئي للزوجات) + `family_members_wife_ordinal_chk`: قيد 4 زوجات (راجع أدناه).

قاعدة Head XOR Member عبر جدولين → لا يمكن فرضها بـ CHECK في PostgreSQL → تُفرض في معاملة الخدمة (راجع "مصفوفة الإنفاذ").

### قاعدة 4 زوجات

```sql
CONSTRAINT family_members_wife_ordinal_chk CHECK (
  CASE WHEN relationship = 'wife' THEN wife_ordinal BETWEEN 1 AND 4
       ELSE wife_ordinal IS NULL END
);
CREATE UNIQUE INDEX family_members_wife_slot_uidx
  ON family_members (family_profile_id, wife_ordinal)
  WHERE relationship = 'wife';
```

طبقتا حماية: الزوجة الخامسة تحتاج `wife_ordinal = 5` (ترفضه CHECK) أو رقمًا مشغولًا (يرفضه الـ unique index).

**استراتيجية الـ Race Condition (موثقة للتنفيذ لاحقًا):**

1. `BEGIN` ثم `SELECT ... FOR UPDATE` على صف `family_profiles` (نقطة التسلسل).
2. قراءة الأرقام المشغولة واختيار رقم حر ضمن 1..4 (يسمح بإعادة استخدام رقم تحرر بعد حذف زوجة).
3. `INSERT` — أي تعيينين متزامنين لنفس الرقم ينتهيان بانتهاك فريد (23505) → تعيد الخدمة المحاولة.

---

## مصفوفة توافق نوع الحساب والدور (Account Type / Role Compatibility)

الشكل القانوني الوحيد:

| account_type | auth_method | الأدوار المسموحة | person_id | username |
|---|---|---|---|---|
| `family_head` | `national_id` | `family_head` فقط | **NOT NULL** | **NULL** |
| `administrative` | `username` | `branch_admin`، `publisher`، `admin`، `general_manager` | اختياري (قد يرتبط بشخص) | **NOT NULL** ويبدأ بـ `admin-` |

ممنوع معماريًا:

- حساب `family_head` + أي دور إداري.
- حساب `administrative` + دور `family_head`.
- دور `guest` على أي صف في `users` (الضيف زائر غير مصادق، بلا حساب أصلًا).

### حدود الإنفاذ

**ما تفرضه قاعدة البيانات (same-row CHECKs):**

```sql
CONSTRAINT users_account_type_auth_method_chk CHECK (
  CASE
    WHEN account_type = 'family_head'    THEN auth_method = 'national_id' AND person_id IS NOT NULL
    WHEN account_type = 'administrative' THEN auth_method = 'username'    AND username IS NOT NULL
    ELSE FALSE  -- fail-safe: أي قيمة enum مستقبلية ترفض حتى تُقرر صراحة
  END
);

CONSTRAINT users_admin_username_prefix_chk CHECK (
  CASE
    WHEN account_type = 'administrative' THEN username LIKE 'admin-%'
    ELSE username IS NULL
  END
);
```

**ما لا تستطيع قاعدة البيانات فرضه — بقصد:**

توافق `account_type` مع الدور قاعدة **عبر الجداول** (`users.role_id` → `roles.code`)، وCHECK في PostgreSQL لا يمكنه الإشارة إلى جدول آخر. البدائل المرفوضة:

- CHECK cross-table: غير قابل للتنفيذ في PostgreSQL أصلًا.
- نسخ `role_code` منسوخًا داخل `users` لفرضه محليًا: مرفوض — ازدواج تمثيل الدور وخطر عدم التزامن.

**القرار:** يُفرض التوافق في **Service/Domain transaction** عند أي `INSERT/UPDATE` على `users` (التحقق من زوج `account_type + role.code` مقابل المصفوفة أعلاه قبل الكتابة)، وتوثيق ذلك ملزم لأي تنفيذ مستقبلي.

---

## OTP — تصميم "التحدي الحالي" (Current Challenge)

`otp_verifications` يحتفظ بصف واحد بالضبط لكل `(phone, purpose)`:

```sql
CREATE UNIQUE INDEX otp_phone_purpose_uidx ON otp_verifications (phone, purpose);
```

### لماذا ليس `UNIQUE(phone, purpose) WHERE consumed_at IS NULL`؟

تحدٍ **منتهي الصلاحية** يبقى بـ `consumed_at = NULL` (لم يُستهلك — انتهى فقط)، فيحجز القيد الجزئي ويمنع إصدار OTP جديد حتى تدخل يدوي. الـ UNIQUE الكامل يستحيل هذا: التحدي الجديد يعيد استخدام نفس الصف دائمًا.

### Resend = تحديث واحد لنفس الصف

```sql
UPDATE otp_verifications SET
  otp_hash      = <hash(new code)>,
  expires_at    = now() + ttl,
  attempts      = 0,
  last_sent_at  = now(),
  resend_count  = resend_count + 1,
  consumed_at   = NULL,
  locked_until  = NULL            -- عند سماح سياسة الـ resend
WHERE phone = $1 AND purpose = $2;
```

- الإصدار عند غياب الصف = `INSERT`؛ أي سباق متزامن ينهار إلى 23505 فتعيد الخدمة المحاولة.
- سياسة الـ lock: التحدي المقفول (`locked_until` بعد استنفاد المحاولات) لا يُعاد إرساله إلا بعد انقضاء القفل أو وفق سياسة معتمدة أعلى — القرار النهائي للسياسة وقت التنفيذ، والـschema يدعم الخيارين لأن الـ resend يعيد كتابة كل حقول التحدي في تحديث واحد.

### الضمانات المحفوظة

| الضمان | الآلية |
|---|---|
| hashed | `otp_hash` فقط — لا يُخزن الرمز الخام أبدًا |
| single-use | الاستهلاك = `UPDATE ... SET consumed_at = now() WHERE consumed_at IS NULL AND ...` داخل معاملة التحقق |
| expiring | `expires_at` (+ `otp_expiry_after_create_chk`) |
| attempt-limited | `attempts <= max_attempts` (CHECK) |
| rate-limited | `resend_count` + `window_started_at` + `last_sent_at` |
| lockable | `locked_until` |

### التاريخ

لا يُحتفظ بسجل تاريخي للـOTP **بقصد** — لا تضف جدول `otp_history` إلا لظهور حاجة امتثال صريحة. أحداث دورة حياة OTP (sent/verified/locked) تُسجَّل في `audit_logs` دون الرمز أو الهاش. **لم يُنفذ أي OTP service الآن** — هذا توثيق تصميم فقط.

---

## الانتهاء التلقائي (Automatic Expiration) — news / announcements

حقيقة معمارية قاطعة: **`expire_at` لا يغيّر الـstatus تلقائيًا** — PostgreSQL لا يعدّل الصفوف بمجرد مرور الزمن، ولا يوجد trigger/job يفعل ذلك في هذه المرحلة.

التصميم النهائي من قطعتين متعاونتين:

1. **الاستعلام العام (منذ اليوم الأول، لا يعتمد على أي job):**

```sql
-- الأقواس إلزامية: AND أسبق من OR
SELECT ... FROM news
WHERE status = 'published'
  AND (expire_at IS NULL OR expire_at > now())
  AND deleted_at IS NULL;
```

   (الأسلوب نفسه ينطبق على `announcements`؛ مع شرط إضافي اختياري على مستوى الخدمة: `publish_at IS NULL OR publish_at <= now()`.)

2. **Scheduled Job لاحق** (غير منفذ الآن) ينقل الحالة تنظيفًا/أرشفة:

```sql
UPDATE news SET status = 'expired', updated_at = now()
WHERE status = 'published' AND expire_at <= now();
```

الفهرس الجزئي `news_public_expiry_idx` / `announcements_public_expiry_idx` (`ON (expire_at) WHERE status = 'published'`) يخدم الاستعلام العام والـJob المستقبلي معًا. حتى قبل تشغيل أي Job، المحتوى المنتهي **غير ظاهر للعامة** بفضل مسار الاستعلام، والـstatus الدلالي يُصحَّح لاحقًا بلا أثر على المستخدم.

---

## مصفوفة الإنفاذ: قاعدة البيانات مقابل الخدمة

| القاعدة | DB | الخدمة (لاحقًا) |
|---|:--:|:--:|
| Global National ID uniqueness | ✅ `people_national_id_uidx` | — |
| لا ازدواج تمثيل شخص (مركزية `people`) | ✅ FKs + `family_members_person_uidx` | — |
| Head XOR Member (لا صف member للـhead) | ❌ عبر الجداول | ✅ معاملة + قفل صف `people` |
| هاتف nullable لغير الـhead | ✅ | — |
| هاتف الـHead الأساسي مطلوب | ❌ (شرط الـhead في جدول آخر) | ✅ Registration/Service validation |
| الهاتف 10 أرقام بالضبط عند إدخاله | ✅ CHECK (varchar وليس integer) | — |
| حد 4 زوجات + ordinal ∈ 1..4 | ✅ CHECK + unique جزئي | — |
| تعيين wife_ordinal ضد السباقات | backstop (23505) | ✅ معاملة + `FOR UPDATE` |
| family_head → national_id + person_id + username NULL | ✅ CHECK | — |
| administrative → username + بادئة `admin-` | ✅ CHECK | — |
| توافق account_type ↔ role | ❌ عبر الجداول | ✅ معاملة الخدمة |
| تاريخ ميلاد غير مستقبلي | ❌ زمني متغير | ✅ validation وقت الكتابة |
| OTP: تنسيق/محاولات/انتهاء | ✅ CHECKs | — |
| OTP: hash/single-use/rate-limit/lock | هيكل أعمدة | ✅ منطق الخدمة |
| الظهور العام للمحتوى المنتهي | ✅ مسار استعلام | ✅ Job لاحق ينقل الحالة |
| عزل الفروع (Branch isolation) | فهارس + FKs | ✅ فلترة server-side إلزامية |
| ملكية الأسرة (Family ownership) | ❌ عبر الجداول | ✅ فلترة server-side إلزامية |

---

## ملاحظات الترحيل (Migration Notes)

المشروع يُدفع حاليًا عبر `npx drizzle-kit push` ولا توجد migrations مجلدة. إذا وُجدت قاعدة بيانات مبنية على المراجعة **السابقة** للـschema، طبّق يدويًا بهذا الترتيب:

```sql
-- 1) people.phone يصبح اختياريًا مع نفس تنسيق الـ10 أرقام
ALTER TABLE people ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE people DROP CONSTRAINT people_phone_format_chk;
ALTER TABLE people ADD CONSTRAINT people_phone_format_chk
  CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$');

-- 2) OTP: من الفريد الجزئي إلى فريد كامل (تحدي حالي واحد لكل phone+purpose)
--    أولاً إزالة أي صفوف مكررة قديمة (الاحتفاظ بالأحدث لكل phone+purpose)
DELETE FROM otp_verifications a
USING otp_verifications b
WHERE a.phone = b.phone
  AND a.purpose = b.purpose
  AND a.created_at < b.created_at;

DROP INDEX IF EXISTS otp_active_unique_idx;
DROP INDEX IF EXISTS otp_phone_purpose_idx;
CREATE UNIQUE INDEX otp_phone_purpose_uidx ON otp_verifications (phone, purpose);

-- 3) فهارس الانتهاء التلقائي (تخدم الاستعلام العام + الـJob المستقبلي)
CREATE INDEX IF NOT EXISTS news_public_expiry_idx
  ON news (expire_at) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS announcements_public_expiry_idx
  ON announcements (expire_at) WHERE status = 'published';

-- 4) users_account_type_auth_method_chk: استبدال ELSE ضمني بـ WHEN صريح + ELSE FALSE
--    (نفس المنطق للصفوف القائمة؛ تفاحم fail-safe للقيم المستقبلية)
ALTER TABLE users DROP CONSTRAINT users_account_type_auth_method_chk;
ALTER TABLE users ADD CONSTRAINT users_account_type_auth_method_chk CHECK (
  CASE
    WHEN account_type = 'family_head'    THEN auth_method = 'national_id' AND person_id IS NOT NULL
    WHEN account_type = 'administrative' THEN auth_method = 'username'    AND username IS NOT NULL
    ELSE FALSE
  END
);
```

**تحذير ترحيل OTP:** الخطوة 2 تحذف سجلات تحدٍ قديمة مكررة (المستهلكة تاريخيًا) — لا قيمة دائمة لها (لا يوجد متطلب تاريخ OTP)، لكن إن وُجدت قاعدة انتهازية للتدقيق، صدّرها إلى `audit_logs` أو نسخة احتياطية قبل الحذف. أي عملية ترحيل تُنفذ داخل نافذة صيانة مع backup مجرّب.

---

## خرائط الجداول السريعة

| المجال | الجداول |
|---|---|
| الهوية | `people`, `users`, `roles`, `permissions`, `role_permissions` |
| الأسرة | `family_profiles`, `family_members`, `war_wounded_records` |
| الفروع | `branches` |
| الطلبات | `registration_requests`, `registration_request_attachments`, `modification_requests`, `family_member_requests` |
| المحتوى | `news`, `announcements`, `archive_posts`, `archive_images` |
| الأمان | `otp_verifications`, `audit_logs` |
| الإشعارات | `notifications` |
| الاستيراد/التصدير | `import_export_batches`, `import_errors` |
