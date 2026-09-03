# Architecture Review

> هذا الملف يوثّق جولات المراجعة تراكميًا: الجولة الأولى (سياق تاريخي — كل بنودها عولجت)، الجولة الثانية (تصحيحات الـSchema النهائية)، ثم الجولة الثالثة (Final Pre-Implementation Requirements Verification — قواعد العمل النهائية) التي تُغلق مرحلة ما قبل التنفيذ. ما يتعارض بين الجولات تعتمد فيه الأحدث.

---

# الجولة الثانية — Final Pre-Implementation Corrections (تصحيح الـSchema)

## Issues Found & Fixed

1. **`people.phone` كان `NOT NULL`** — يخالف المتطلبات: الهاتف الأساسي ليس مطلوبًا لكل فرد أسرة.
   - **Fix:** العمود أصبح nullable؛ تنسيق `^[0-9]{10}$` بالضبط عند الإدخال (CHECK محدث: `phone IS NULL OR phone ~ '^[0-9]{10}$`)؛ `secondary_phone` كما هو nullable؛ التخزين `varchar` وليس integer؛ هاتف Family Head مطلوب على مستوى Registration/Service validation فقط (لا `NOT NULL` على العمود). متطلبات Family Head لم تتغير.
2. **تصميم OTP يمنع الـresend بعد انتهاء الصلاحية** — `UNIQUE(phone, purpose) WHERE consumed_at IS NULL` يجعل التحدي المنتهي (غير المستهلك، أي `consumed_at = NULL`) يحجز القيد ويمنع إصدار OTP جديد.
   - **Fix:** اعتماد تصميم "التحدي الحالي": `UNIQUE(phone, purpose)` كامل (بلا WHERE) — صف واحد لكل phone+purpose. الـresend تحديث واحد لنفس الصف (otp_hash / expires_at / تصفير attempts / last_sent_at / زيادة resend_count / تصفير consumed_at / تصفير locked_until وفق سياسة الـresend). لا جدول history (بقصد) — أحداث دورة الحياة (بلا رمز/هاش) إلى `audit_logs`. لم يُنفذ OTP service.
3. **توافق account_type/role غير موثق كقاعدة معمارية** —
   - **Fix:** مصفوفة قانونية موثقة: `family_head → (national_id, role=family_head, person_id≠null, username=null)` و`administrative → (username ببادئة admin-, role ∈ {branch_admin, publisher, admin, general_manager})`. الممنوع: family_head + دور إداري، administrative + family_head. لم يُفرض عبر CHECK cross-table (غير قابل للتنفيذ في PostgreSQL) — يُفرض في Service/Domain transaction، ويوثق ذلك في تعليق `users` بالـschema + `docs/database-schema.md` + `docs/architecture-plan.md`. تحسين إضافي: `users_account_type_auth_method_chk` أصبح بفرعين صريحين + `ELSE FALSE` (fail-safe).
4. **"الانتهاء التلقائي" يحتاج توثيقًا قاطعًا** —
   - **Fix:** توثيق صريح أن `expire_at` لا يغيّر الـstatus تلقائيًا أبدًا. التصميم: مسار استعلام عام دائم `status='published' AND (expire_at IS NULL OR expire_at > NOW())` + Job مستقبلي (غير منفذ) ينقل `published → expired`. فهرس جزئي `news_public_expiry_idx` / `announcements_public_expiry_idx` يدعم الاثنين.
5. **تمثيل Family Head يحتاج تحصينًا ضد الازدواج** —
   - **Fix:** توثيق قاطع: `family_profiles.head_person_id` هو تمثيل الـHead؛ الـHead لا يحصل على صف في `family_members` لمجرد كونه head؛ تمثيل الشخص في أسره مرة واحدة بالضبط (Head XOR Member)؛ الاستثناءية عبر الجداول تُفرض في معاملة الخدمة مع قفل صف `people`.

## Files Changed (هذه الجولة)
- `src/db/schema.ts` — التعديلات أعلاه + تعليقات معمارية ملزمة على الجداول المتأثرة.
- `docs/database-schema.md` — ملف جديد: توثيق كامل للـSchema + مصفوفة الإنفاذ (DB مقابل الخدمة) + ملاحظات الترحيل.
- `docs/architecture-plan.md` — تحديث شامل (الهاتف، التوافق، الملكية، الانتهاء، OTP، العزل، Audit).
- `docs/09-architecture-review.md` — هذا القسم.

## Verification Checklist (نتائج التحقق النهائي)

| # | البند | الحالة | أين يُفرض |
|---|---|:--:|---|
| 1 | Global National ID uniqueness | ✅ | DB: `people_national_id_uidx` |
| 2 | No duplicate person representation | ✅ | DB: مركزية `people` + FKs + `family_members_person_uidx`؛ Head XOR Member في الخدمة |
| 3 | Phone nullable for non-head members | ✅ | DB: العمود nullable |
| 4 | Family Head phone required (service level) | ✅ | الخدمة (Registration validation) — موثق في schema comment + docs |
| 5 | Phone exactly 10 digits when present | ✅ | DB: CHECKs (phone + secondary_phone)؛ varchar وليس integer |
| 6 | Max 4 wives | ✅ | DB: CHECK ordinal 1..4 + unique جزئي على slot |
| 7 | Wife ordinal 1..4 | ✅ | DB: نفس CHECK |
| 8 | Wife race condition strategy documented | ✅ | الخدمة: Transaction + `FOR UPDATE` على family_profiles؛ backstop 23505 |
| 9 | No invalid PostgreSQL time-varying CHECK | ✅ | تم فحص الـschema — لا يوجد NOW()/CURRENT_DATE في أي CHECK |
| 10 | OTP resend works after expiry | ✅ | DB: `UNIQUE(phone, purpose)` كامل — لا صف منتهٍ يحجز |
| 11 | OTP single-use | ✅ | `consumed_at` + دلالات consume (تحديث شرطي في معاملة التحقق) — موثقة |
| 12 | Admin username starts with `admin-` | ✅ | DB: `users_admin_username_prefix_chk` |
| 13 | Account type ↔ role compatibility documented | ✅ | المصفوفة + مالك الإنفاذ (خدمة) موثقة في schema + docs |
| 14 | Branch isolation documented | ✅ | architecture-plan (Scope Enforcement) |
| 15 | Family ownership documented | ✅ | architecture-plan + family_profiles comment |
| 16 | Sensitive data protection documented | ✅ | architecture-plan (Audit & Sensitive Data) |
| 17 | Audit architecture documented | ✅ | architecture-plan + database-schema |
| 18 | Automatic expiration architecture documented | ✅ | مسار استعلام عام + Job لاحق + فهارس جزئية — موثق |

## Verification Method
- `tsc --noEmit`: نجاح بلا أخطاء.
- توليد DDL عبر `drizzle-kit generate`: نجاح — تم التأكد يدويًا من: `people.phone` nullable مع CHECK المحدث، `otp_verifications.phone` يبقى NOT NULL (لكل تحدٍ هاتف)، `otp_phone_purpose_uidx` (فريد كامل، أُزيل الفهرس غير الفريد المكرر)، الفهرين الجزئيين للانتهاء، وCHECK الحسابات المحسّن.
- فحص يدوي: لا يوجد أي CHECK زمني متغير في `src/db/schema.ts`.

## Out of Scope (لم يبدأ — مقصود)
UI / API / Auth implementation / Registration implementation / OTP implementation / Dashboard / CRUD / Notifications implementation / File upload implementation / Scheduled expiration job.

## Remaining Risks (بعد الجولة الثانية)
1. قاعدة "تاريخ الميلاد غير مستقبلي" تعتمد على validation/service وقت التنفيذ (ليست CHECK ثابتة) — مالك معروف، مقبول.
2. توافق role مع `account_type`: موثق بمصفوفة قانونية + مالك إنفاذ (Service/Domain transaction) — يُنفذ في مرحلة التنفيذ.
3. حماية race conditions (wife_ordinal، Head XOR Member، انتقال الأسرة المستقلة): استراتيجية موثقة (Transaction + `FOR UPDATE` + backstop 23505) — تُطبق عند التنفيذ الفعلي.
4. تنفيذ الصلاحيات الفعلي (Policies/Guards) مؤجل للمرحلة التنفيذية التالية — بقصد.
5. الـstatus الدلالي للمحتوى المنتهي يصححه Job مستقبلي؛ حتى تشغيله، الإخفاء مضمون عبر مسار الاستعلام العام (لا يظهر محتوى منتهٍ للعامة).

---

# الجولة الثالثة — Final Pre-Implementation Requirements Verification (قواعد العمل النهائية)

> جولة إغلاق نهائية: إضافة قواعد العمل النهائية (انتقال الأسرة المستقلة، استعادة كلمة المرور، إعادة التعيين الإداري، مقدمة الأرشيف الثابتة، المشاركة المجهولة في الأرشيف، مواصفة استيراد Excel) وتوثيقها — دون بدء التنفيذ.

## Files Changed (هذه الجولة)
- `src/db/schema.ts` — إضافة `archive_image_submissions` + enum الحالة (إضافة فقط، لا تعديل على أي جدول قائم).
- `docs/architecture-plan.md` — قاعدة الانتقال المستقل، تدفق استعادة كلمة المرور، إعادة التعيين الإداري (GM)، الأرشيف (المقدمة الثابتة + المشاركة المجهولة)، مواصفة Excel، مصفوفة الصلاحيات، أحداث الـaudit، نقاط إنفاذ الأمان.
- `docs/database-schema.md` — أقسام: الانتقال المستقل، الاستعادة/إعادة التعيين (طبقة البيانات)، جدول المشاركات المجهولة، صفوف مصفوفة الإنفاذ الجديدة، خريطة الجداول.
- `docs/09-architecture-review.md` — هذا القسم.

## Checklist

- [x] Independent Family Member → Independent Family transfer (طلب عبر موافقة فرع، ليس نقلًا فوريًا — architecture-plan + database-schema)
- [x] Explicit user confirmation before transfer request (نص التحذير العربي المقترح + تأكيد صريح قبل الإرسال)
- [x] Atomic transfer transaction (6 خطوات في معاملة واحدة + rollback كامل عند أي فشل)
- [x] Family Head cannot create second family (`family_profiles_head_person_uidx` + تحقق الخدمة)
- [x] Existing member cannot belong to multiple families (`family_members_person_uidx` + Head XOR Member)
- [x] Password recovery: National ID → phone confirmation → OTP (5 خطوات موثقة)
- [x] Last-two-digits phone hint ("رقم الهاتف المرتبط بالحساب ينتهي بـ 67" — آخر رقمين فقط)
- [x] Lost phone → Technical Support (لا تحويل إلى Branch Admin — موثق صراحة في المصفوفة والتدفق)
- [x] General Manager can reset another user's password (حصريًا للـGM — RBAC matrix)
- [x] Password reset is audited (actor/target/timestamp/action/result/metadata — بلا نص صريح أبدًا)
- [x] Static Abu Jame'a family introduction in Archive (static content — ليست post، ليست في DB، لا جدول جديد)
- [x] Anonymous archive image + text submission (يُجمع حصريًا: صورة + نص)
- [x] Publisher review/preview/edit/publish/reject (دورة كاملة موثقة)
- [x] No sender notifications (لا استلام/قبول/رفض)
- [x] No sender account/data collection (جدول `archive_image_submissions` بلا أي عمود هوية — ومنع إضافتها مستقبلًا)
- [x] Anonymous upload security requirements (حجري/حجم/نوع/magic bytes/rate limiting/معالجة آمنة)
- [x] Excel import specification (الأوراق الثلاث، الأعمدة، المحظورات، التحققات، تقرير أخطاء قبل الالتزام)
- [x] RBAC consistency (مصفوفة الصلاحيات الكاملة محدّثة بالقواعد الجديدة دون توسيع زائد)
- [x] Audit requirements (جدول أحداث audit المطلوبة + ممنوعات الـaudit)
- [x] Security review (جدول نقاط إنفاذ الأمان — مستوى توثيق، دون تنفيذ)
- [x] No unresolved documentation contradictions (فحص تقاطعي أدناه)

## فحص التناقضات (Cross-document check)

- README ↔ architecture-plan ↔ database-schema ↔ 09-architecture-review ↔ schema.ts: لا تناقض — README لا يذكر استعادة/أرشيف/استيراد بتفاصيل تتعارض مع الجديد.
- لا يوجد في أي ملف قاعدة قديمة تمنع عضو أسرة متزوج من أن يصبح رب أسرة مستقل (بحث نصي عبر المستودع — لا نتائج بهذا المعنى).
- لا يوجد أي توجيه قديم لفقدان الهاتف نحو Branch Admin (أُضيف النفي الصريح في المصفوفة والتدفق).
- مقدمة الأرشيف موصوفة STATIC وغير مدعومة بقاعدة بيانات في architecture-plan (وdatabase-schema لا تُعرّف لها جدولًا).
- مشاركة الأرشيف العامة: صورة + نص فقط — مؤكدة في architecture-plan وdatabase-schema وschema.ts (لا أعمدة هوية).
- قيود DB السابقة لم تُضعف: لم يُمس أي CHECK/فهرس قائم؛ الإضافة الوحيدة جدول + enum جديدان.

## Schema Changes (هذه الجولة)

**إضافة فقط — لا تعديل على أي جدول قائم:**

1. `archive_submission_status_enum` (`pending`/`published`/`rejected`).
2. جدول `archive_image_submissions`: الكيان الدائم للمشاركات المجهولة (صورة + نص) — بلا أي عمود هوية مرسل:
   - قيود: حجم ≤ 5MB، extension ∈ jpg/jpeg/png، MIME ∈ image/jpeg/image/png، اتساق المراجعة (reviewed_at + reviewed_by عند الحسم)، ربط المنشور (`published_archive_post_id` NOT NULL إذا وفقط إذا status=published).
   - فهارس: status (طابور المعلّقة) + created_at.
   - علاقات: reviewed_by → users، published_archive_post_id → archive_posts.

قرار التصميم: الانتقال المستقل لعضو أسرة، واستعادة كلمة المرور، وإعادة التعيين الإداري، ومقدمة الأرشيف الثابتة — **لا تتطلب أي تغيير schema** (البنية القائمة تدعمها؛ التوثيق يحدد المعاملات والملكية).

## Open Decisions Before Implementation (تحتاج موافقة بشرية)

1. **آلية إلزام تغيير كلمة المرور بعد إعادة التعيين الإداري:** عمود `users.must_change_password` أم آلية بديلة (password_reset_at)؟ — لا يمكن تنفيذ قاعدة GM كاملة دون حسم هذا.
2. **تمييز طلب الأسرة المستقلة:** اعتمدنا إعادة استخدام `registration_requests` مع discriminator داخل payload (`requestType: "independent_family"`) — هل يُفضَّل عمود صريح (`request_type`) عند بدء التنفيذ؟
3. **قناة تقديم طلب الأسرة المستقلة:** العضو عادةً بلا حساب — نموذج عام بالهوية+تحقق، أم عبر رب الأسرة الحالي، أم بإدخال من Branch Admin؟ (يحدد كيفية عرض التحذير والتحقق من الهوية قبل كشف انتسابه).
4. **سياسة تكرار الهاتف في الاستيراد:** هل يُمنع تكرار نفس الهاتف الأساسي عبر الأشخاص؟ الافتراضي الحالي: مسموح (لا قيد فريد) — يحتاج تأكيدًا.
5. **صيغة دمج أجزاء الاسم الأربعة** في `people.full_name` عند الاستيراد (مسافة واحدة بين الأجزاء غير الفارغة؟ ترتيب؟) — يحتاج تثبيتًا.
6. **توسيع قائمة أنواع صور المشاركات** (webp/gif؟) والحد الأقصى للحجم (مثبَّت حاليًا 5MB متناسقًا مع المرفقات) — يحتاج تأكيدًا.
7. **كلمة مرور مؤقتة أم رابط إعادة تعيين** في عملية الـGM (كلاهما ممكن ضمن نفس البنية؛ يحسم آلية التسليم للهدف).
8. **نطاق الدعم الفني لـ Account Recovery:** العملية موجّهة للدعم الفني الرسمي — إجراءات التحقق الخاصة بها خارج نطاق هذه الجولة وتُوثَّق قبل تنفيذها.

## الخاتمة

Implementation has NOT started. The repository is now prepared for the Implementation phase pending final human review.

---

# الجولة الأولى — Historical Review (سياق تاريخي)

## Critical Issues Found (عولجت كلها)
1. **Global National ID uniqueness غير مضمونة** بسبب توزيع `national_id` بين `users` و`family_members`.
2. **تمثيل الشخص مكرر** (بيانات الشخص محفوظة مباشرة في أكثر من جدول) مما يسمح بازدواج الهوية.
3. **قاعدة 4 زوجات غير محمية ضد التوازي** لعدم وجود قيد بنيوي قوي يمنع الزوجة الخامسة.
4. **وجود CHECK constraints بزمن متغير** (`CURRENT_DATE`) في تواريخ الميلاد.
5. **تداخل نموذج RBAC** بين role enum داخل users + جداول roles/permissions.

## High Priority Issues
1. استخدام `ON DELETE CASCADE` في مواضع حساسة قد يسبب فقدان تاريخي غير مقصود.
2. عدم وجود قواعد DB واضحة لحقول مرفقات التسجيل (الحجم/النوع/عدد الملفات).
3. عدم اتساق نمذجة حالات الطلبات بين أنواع الطلب المختلفة.
4. ضعف اتساق فصل الحساب الإداري عن حساب رب الأسرة في مستوى Schema.

## Medium Priority Issues
1. بعض الحقول كانت زائدة/مكررة وتسمح بتعارضات domain.
2. ضعف التوافق بين قابلية التتبع (Auditability) وبعض خيارات الحذف.
3. فهارس ناقصة لسيناريوهات الاستعلام المتوقع (status + created_at + branch scope).

## Database Changes (الجولة الأولى)
1. إضافة جدول مركزي `people` كمرجع هوية موحد.
2. نقل الهوية الشخصية (national_id والبيانات الشخصية/الصحية/الهاتف) إلى `people`.
3. تعديل `users` ليصبح حساب دخول فقط مع:
   - `account_type` + `auth_method`
   - `person_id` اختياري
   - `username` إجباري للحسابات الإدارية مع بادئة `admin-`
4. تعديل `family_profiles` لاستخدام `head_person_id` بدل `head_user_id`.
5. تعديل `family_members` لاستخدام `person_id` ومنع تكرار الشخص.
6. إضافة `wife_ordinal` + قيود تمنع تجاوز 4 زوجات.
7. إزالة الاعتماد على CHECK time-variant لمنع تواريخ مستقبلية (توثيق فرضها وقت الكتابة في الخدمة).
8. تحسين جداول الطلبات بإضافة حقول reviewer/reviewed_at/reason/check consistency.
9. تشديد جدول المرفقات:
   - `attachment_slot` (1..5)
   - حجم ≤ 5MB
   - extension/mime whitelist
   - `visibility=private`
10. توحيد حالات News/Announcements بنموذج status واضح مع الحفاظ على الأرشفة.
11. تطوير بنية OTP لتشمل lock/rate-limiting/single-use.
12. تحسين بنية import/export مع `import_export_batches` و`import_errors`.

## Architecture Changes (الجولة الأولى)
1. اعتماد Identity Model مركزي Person-centric.
2. فصل Authentication account model عن Person domain model.
3. توحيد RBAC حول `roles` + `permissions` + `role_permissions` + `users.role_id`.
4. توثيق صريح لآلية scope enforcement:
   - Branch Admin -> branch-bound server-side
   - Family Head -> ownership-bound server-side
5. توثيق explicit approval workflow لجميع الطلبات.

## Security Changes (الجولة الأولى)
1. National ID uniqueness عالميًا عبر `people.national_id UNIQUE`.
2. منع ازدواج الشخص عبر مراجع FK إلى people.
3. قاعدة admin username enforced على مستوى DB checks (`admin-`).
4. قيود صريحة على الهاتف (10 أرقام) وعدم استخدام integer.
5. المرفقات الخاصة default private + قيود نوع/حجم.
6. OTP schema hardened (expiry + attempts + lock + consumed state).
7. Audit log architecture محسّن لتتبع before/after/action/actor/target.

## Decisions (الجولة الأولى)
1. **الإبقاء على Stack الحالي (Next.js + Drizzle + PostgreSQL)** في هذه المرحلة.
2. **عدم تنفيذ Features/APIs/UI** والاكتفاء بتصحيح المعمارية والـSchema.
3. **اختيار Person-centric model** كأفضل حل لشرط Global National ID.
4. **حل قاعدة 4 زوجات عبر wife slots (1..4)** مع متطلبات transaction/locking في طبقة الخدمة لاحقًا.

## Rejected Alternatives (الجولة الأولى)
1. **الإبقاء على national_id في users + family_members**: مرفوض لأنه لا يضمن global uniqueness.
2. **إضافة family_wives منفصل**: مرفوض لتجنب ازدواج تمثيل الزوجة.
3. **فرض تواريخ غير مستقبلية عبر CHECK بـ CURRENT_DATE**: مرفوض لضعف موثوقية constraints الزمنية المتغيرة.
4. **تحويل فوري إلى Laravel backend**: مرفوض في هذه المرحلة لارتفاع كلفة التحويل وابتعاده عن نطاق المهمة.

## Migration Impact (الجولة الأولى)
1. ترحيل بنيوي كبير يتطلب:
   - إنشاء `people`
   - إعادة ربط `users/family_profiles/family_members`
2. أي بيانات قائمة تحتاج script ترحيل مخصص لضمان عدم فقد السجلات.
3. يجب تنفيذ الترحيل داخل نافذة صيانة مع backup واسترجاع مجرّب.

> ملاحظة الجولة الأخيرة: خطوات الترحيل التفصيلية من المراجعة السابقة للـSchema (بما فيها dedupe سجلات OTP القديمة قبل تطبيق الفريد الكامل) موثقة الآن في `docs/database-schema.md` → "ملاحظات الترحيل (Migration Notes)".

---

FINAL ARCHITECTURE CHECK COMPLETE

Schema status: READY
Architecture status: READY
Critical issues remaining: NONE — القواعد غير القابلة للإنفاذ في PostgreSQL (توافق account_type↔role، Head XOR Member، هاتف الـHead، التحقق الزمني المتغير) موثقة بمالك إنفاذ صريح في طبقة الخدمة (Service/Domain transaction) وستُفرض عند بدء التنفيذ.
Implementation started: NO
