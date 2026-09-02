# Architecture Review

## Critical Issues Found
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

## Database Changes
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

## Architecture Changes
1. اعتماد Identity Model مركزي Person-centric.
2. فصل Authentication account model عن Person domain model.
3. توحيد RBAC حول `roles` + `permissions` + `role_permissions` + `users.role_id`.
4. توثيق صريح لآلية scope enforcement:
   - Branch Admin -> branch-bound server-side
   - Family Head -> ownership-bound server-side
5. توثيق explicit approval workflow لجميع الطلبات.

## Security Changes
1. National ID uniqueness عالميًا عبر `people.national_id UNIQUE`.
2. منع ازدواج الشخص عبر مراجع FK إلى people.
3. قاعدة admin username enforced على مستوى DB checks (`admin-`).
4. قيود صريحة على الهاتف (10 أرقام) وعدم استخدام integer.
5. المرفقات الخاصة default private + قيود نوع/حجم.
6. OTP schema hardened (expiry + attempts + lock + consumed state).
7. Audit log architecture محسّن لتتبع before/after/action/actor/target.

## Decisions
1. **الإبقاء على Stack الحالي (Next.js + Drizzle + PostgreSQL)** في هذه المرحلة.
2. **عدم تنفيذ Features/APIs/UI** والاكتفاء بتصحيح المعمارية والـSchema.
3. **اختيار Person-centric model** كأفضل حل لشرط Global National ID.
4. **حل قاعدة 4 زوجات عبر wife slots (1..4)** مع متطلبات transaction/locking في طبقة الخدمة لاحقًا.

## Rejected Alternatives
1. **الإبقاء على national_id في users + family_members**: مرفوض لأنه لا يضمن global uniqueness.
2. **إضافة family_wives منفصل**: مرفوض لتجنب ازدواج تمثيل الزوجة.
3. **فرض تواريخ غير مستقبلية عبر CHECK بـ CURRENT_DATE**: مرفوض لضعف موثوقية constraints الزمنية المتغيرة.
4. **تحويل فوري إلى Laravel backend**: مرفوض في هذه المرحلة لارتفاع كلفة التحويل وابتعاده عن نطاق المهمة.

## Migration Impact
1. ترحيل بنيوي كبير يتطلب:
   - إنشاء `people`
   - إعادة ربط `users/family_profiles/family_members`
2. أي بيانات قائمة تحتاج script ترحيل مخصص لضمان عدم فقد السجلات.
3. يجب تنفيذ الترحيل داخل نافذة صيانة مع backup واسترجاع مجرّب.

## Remaining Risks
1. قاعدة "تاريخ الميلاد غير مستقبلي" تعتمد على validation/service وقت التنفيذ (ليست CHECK ثابتة).
2. ربط role الفعلي مع `account_type` يحتاج إنفاذ في طبقة الخدمة/السياسات عند التنفيذ.
3. حماية race conditions تتطلب تطبيق Transaction + row locking أثناء التنفيذ الفعلي لعمليات الإضافة/الاعتماد.
4. لا يزال تنفيذ الصلاحيات الفعلي (Policies/Guards) مؤجلًا للمرحلة التنفيذية التالية.
