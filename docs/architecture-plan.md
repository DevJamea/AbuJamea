# منصة عائلة أبو جامع — Corrected Architecture Plan

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

---

## نموذج المستخدمين والحسابات
- `users` يمثل حساب الدخول فقط.
- `account_type`:
  - `family_head`
  - `administrative`
- `auth_method`:
  - `national_id` (لـ Family Head)
  - `username` (للحسابات الإدارية)
- قاعدة إدارية صريحة:
  - الحساب الإداري يجب أن يملك `username` يبدأ بـ `admin-`.

---

## نموذج العائلة والأفراد
- `family_profiles` لبيانات الأسرة.
- `family_members` لربط الأشخاص بالأسرة وصلة القرابة.
- الزوجات لا يوجَد لهن جدول منفصل (`family_wives` غير موجود).
- منع التكرار يتم عبر:
  - Person مركزي
  - مفاتيح فريدة داخل `family_members`

### قاعدة 4 زوجات
تم دعمها تصميميًا في قاعدة البيانات عبر:
- `wife_ordinal` محصور بين 1 و4 فقط عند `relationship='wife'`.
- `UNIQUE (family_profile_id, wife_ordinal)` جزئي للزوجات.

وهذا يمنع إدخال الزوجة الخامسة على مستوى DB.

> ملاحظة تشغيلية: التخصيص التلقائي لـ `wife_ordinal` يجب أن يتم داخل Transaction مع قفل صف `family_profiles` (`FOR UPDATE`) لمنع race condition.

---

## Request / Approval Architecture
### Registration Request
`draft -> submitted -> pending -> approved/rejected`

### Member Request
`pending -> approved/rejected`

### Modification Request
`pending -> approved/rejected`

كل طلب يحمل:
- requester
- branch
- status
- reviewer
- reviewed_at
- reason/note

---

## RBAC Architecture
الأدوار المعتمدة:
- Guest
- Family Head
- Branch Admin
- Publisher
- Admin
- General Manager

RBAC مخزّن عبر:
- `roles`
- `permissions`
- `role_permissions`
- `users.role_id`

### قواعد النطاق (Scope)
- Branch Admin: نطاقه فرعه فقط.
- Family Head: نطاقه أسرته وطلباته وإشعاراته فقط.
- General Manager: إدارة الحسابات الإدارية العليا.

---

## Audit & Sensitive Data Architecture
- `audit_logs` لتسجيل (من؟ ماذا؟ متى؟ على أي سجل؟ قبل/بعد).
- `registration_request_attachments` تخزن `visibility='private'` افتراضيًا.
- بيانات حساسة (هوية/هاتف/صحة) ضمن نموذج وصول مقيد (Auth + Authorization + Ownership).

---

## OTP Architecture (Schema-ready)
`otp_verifications` يدعم:
- phone
- otp_hash
- purpose
- expires_at
- attempts / max_attempts
- resend_count
- locked_until
- consumed_at (single-use)

---

## Import/Export Architecture
- `import_export_batches`
- `import_errors`

مع دعم:
- branch scope
- operation type
- status
- audit-ready metadata

---

## ملاحظة حول CHECK Constraints
تم تجنب استخدام `CURRENT_DATE/NOW()` في CHECK الخاصة بالمنطق الزمني المتغير (مثل منع تاريخ مستقبلي) لأن هذا النوع لا يعد خيارًا موثوقًا معماريًا كقيد دائم.

التحقق الزمني المتغير يُفرض على مستوى Validation/Service وقت الكتابة.
