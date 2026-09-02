import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const roleCodeEnum = pgEnum("role_code", [
  "guest",
  "family_head",
  "branch_admin",
  "publisher",
  "admin",
  "general_manager",
]);

export const accountTypeEnum = pgEnum("account_type", ["family_head", "administrative"]);

export const authMethodEnum = pgEnum("auth_method", ["national_id", "username"]);

export const genderEnum = pgEnum("gender", ["male", "female"]);

export const maritalStatusEnum = pgEnum("marital_status", ["married", "widowed", "divorced"]);

export const healthConditionEnum = pgEnum("health_condition", [
  "healthy",
  "heart_disease",
  "diabetes",
  "hypertension",
  "other",
]);

export const registrationRequestStatusEnum = pgEnum("registration_request_status", [
  "draft",
  "submitted",
  "pending",
  "approved",
  "rejected",
]);

export const reviewStatusEnum = pgEnum("review_status", ["pending", "approved", "rejected"]);

export const memberRelationshipEnum = pgEnum("member_relationship", [
  "wife",
  "son",
  "daughter",
  "mother",
  "father",
  "grandchild",
]);

export const newsStatusEnum = pgEnum("news_status", ["draft", "published", "expired"]);

export const announcementStatusEnum = pgEnum("announcement_status", ["draft", "published", "expired"]);

export const announcementTypeEnum = pgEnum("announcement_type", ["death", "occasion", "congratulation"]);

export const otpPurposeEnum = pgEnum("otp_purpose", ["password_reset", "phone_verification"]);

export const attachmentKindEnum = pgEnum("attachment_kind", ["head_id", "spouse_id", "supporting"]);

export const storageVisibilityEnum = pgEnum("storage_visibility", ["private", "public"]);

export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "sms", "whatsapp"]);

export const importExportOperationEnum = pgEnum("import_export_operation", ["import", "export"]);

export const batchStatusEnum = pgEnum("batch_status", ["pending", "processing", "completed", "failed"]);

export const branches = pgTable(
  "branches",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("branches_name_uidx").on(table.name), uniqueIndex("branches_slug_uidx").on(table.slug)],
);

export const roles = pgTable(
  "roles",
  {
    id: serial("id").primaryKey(),
    code: roleCodeEnum("code").notNull(),
    labelAr: varchar("label_ar", { length: 120 }).notNull(),
    isSystem: boolean("is_system").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("roles_code_uidx").on(table.code)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 160 }).notNull(),
    labelAr: varchar("label_ar", { length: 160 }).notNull(),
    groupName: varchar("group_name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("permissions_code_uidx").on(table.code)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId], name: "role_permissions_pk" })],
);

/**
 * Global person identity table:
 * - national_id is globally unique across the entire domain.
 * - users and family_members both reference people to prevent duplicate person representation.
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nationalId: varchar("national_id", { length: 20 }).notNull(),
    fullName: varchar("full_name", { length: 220 }).notNull(),
    gender: genderEnum("gender").notNull(),
    birthDate: date("birth_date").notNull(),
    phone: varchar("phone", { length: 10 }).notNull(),
    secondaryPhone: varchar("secondary_phone", { length: 10 }),
    maritalStatus: maritalStatusEnum("marital_status"),
    healthCondition: healthConditionEnum("health_condition").notNull().default("healthy"),
    healthConditionOther: varchar("health_condition_other", { length: 200 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("people_national_id_uidx").on(table.nationalId),
    index("people_phone_idx").on(table.phone),
    check("people_national_id_format_chk", sql`${table.nationalId} ~ '^[0-9]{6,20}$'`),
    check("people_phone_format_chk", sql`${table.phone} ~ '^[0-9]{10}$'`),
    check("people_secondary_phone_format_chk", sql`${table.secondaryPhone} IS NULL OR ${table.secondaryPhone} ~ '^[0-9]{10}$'`),
    check(
      "people_health_other_consistency_chk",
      sql`
        CASE
          WHEN ${table.healthCondition} = 'other'
          THEN ${table.healthConditionOther} IS NOT NULL AND length(trim(${table.healthConditionOther})) > 0
          ELSE ${table.healthConditionOther} IS NULL
        END
      `,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id").references(() => people.id, { onDelete: "restrict" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    accountType: accountTypeEnum("account_type").notNull(),
    authMethod: authMethodEnum("auth_method").notNull(),
    username: varchar("username", { length: 80 }),
    passwordHash: text("password_hash").notNull(),
    branchId: integer("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    isDisabled: boolean("is_disabled").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_person_uidx").on(table.personId),
    uniqueIndex("users_username_uidx").on(table.username),
    index("users_role_idx").on(table.roleId),
    index("users_branch_idx").on(table.branchId),
    check(
      "users_account_type_auth_method_chk",
      sql`
        CASE
          WHEN ${table.accountType} = 'family_head'
          THEN ${table.authMethod} = 'national_id' AND ${table.personId} IS NOT NULL
          ELSE ${table.authMethod} = 'username' AND ${table.username} IS NOT NULL
        END
      `,
    ),
    check(
      "users_admin_username_prefix_chk",
      sql`
        CASE
          WHEN ${table.accountType} = 'administrative'
          THEN ${table.username} LIKE 'admin-%'
          ELSE ${table.username} IS NULL
        END
      `,
    ),
  ],
);

export const familyProfiles = pgTable(
  "family_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    headPersonId: uuid("head_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    residenceAddress: text("residence_address"),
    hasWarWounded: boolean("has_war_wounded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("family_profiles_head_person_uidx").on(table.headPersonId),
    index("family_profiles_branch_idx").on(table.branchId),
  ],
);

export const familyMembers = pgTable(
  "family_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyProfileId: uuid("family_profile_id")
      .notNull()
      .references(() => familyProfiles.id, { onDelete: "restrict" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    relationship: memberRelationshipEnum("relationship").notNull(),
    wifeOrdinal: integer("wife_ordinal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("family_members_person_uidx").on(table.personId),
    uniqueIndex("family_members_profile_person_uidx").on(table.familyProfileId, table.personId),
    uniqueIndex("family_members_wife_slot_uidx")
      .on(table.familyProfileId, table.wifeOrdinal)
      .where(sql`${table.relationship} = 'wife'`),
    index("family_members_profile_idx").on(table.familyProfileId),
    index("family_members_relationship_idx").on(table.relationship),
    check(
      "family_members_wife_ordinal_chk",
      sql`
        CASE
          WHEN ${table.relationship} = 'wife'
          THEN ${table.wifeOrdinal} BETWEEN 1 AND 4
          ELSE ${table.wifeOrdinal} IS NULL
        END
      `,
    ),
  ],
);

export const warWoundedRecords = pgTable(
  "war_wounded_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyMemberId: uuid("family_member_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "restrict" }),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("war_wounded_member_uidx").on(table.familyMemberId)],
);

export const registrationRequests = pgTable(
  "registration_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackingCode: varchar("tracking_code", { length: 30 }).notNull(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    headNationalId: varchar("head_national_id", { length: 20 }).notNull(),
    status: registrationRequestStatusEnum("status").notNull().default("draft"),
    payload: jsonb("payload").notNull(),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("registration_requests_tracking_uidx").on(table.trackingCode),
    index("registration_requests_status_idx").on(table.status),
    index("registration_requests_branch_idx").on(table.branchId),
    index("registration_requests_head_nid_idx").on(table.headNationalId),
    index("registration_requests_created_idx").on(table.createdAt),
    check("registration_requests_head_nid_format_chk", sql`${table.headNationalId} ~ '^[0-9]{6,20}$'`),
    check(
      "registration_requests_review_consistency_chk",
      sql`
        CASE
          WHEN ${table.status} IN ('approved','rejected')
          THEN ${table.reviewedAt} IS NOT NULL AND ${table.reviewedByUserId} IS NOT NULL
          ELSE TRUE
        END
      `,
    ),
    check(
      "registration_requests_rejection_reason_chk",
      sql`
        CASE
          WHEN ${table.status} = 'rejected'
          THEN ${table.rejectionReason} IS NOT NULL AND length(trim(${table.rejectionReason})) > 0
          ELSE TRUE
        END
      `,
    ),
  ],
);

export const registrationRequestAttachments = pgTable(
  "registration_request_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    registrationRequestId: uuid("registration_request_id")
      .notNull()
      .references(() => registrationRequests.id, { onDelete: "restrict" }),
    attachmentSlot: integer("attachment_slot").notNull(),
    kind: attachmentKindEnum("kind").notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    extension: varchar("extension", { length: 10 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    visibility: storageVisibilityEnum("visibility").notNull().default("private"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("registration_attachments_request_slot_uidx").on(table.registrationRequestId, table.attachmentSlot),
    index("registration_attachments_request_idx").on(table.registrationRequestId),
    check("registration_attachments_slot_chk", sql`${table.attachmentSlot} BETWEEN 1 AND 5`),
    check("registration_attachments_size_chk", sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 5242880`),
    check("registration_attachments_ext_chk", sql`lower(${table.extension}) IN ('jpg','jpeg','png','pdf')`),
    check(
      "registration_attachments_mime_chk",
      sql`lower(${table.mimeType}) IN ('image/jpeg','image/png','application/pdf')`,
    ),
  ],
);

export const modificationRequests = pgTable(
  "modification_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    familyProfileId: uuid("family_profile_id")
      .notNull()
      .references(() => familyProfiles.id, { onDelete: "restrict" }),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    status: reviewStatusEnum("status").notNull().default("pending"),
    oldValues: jsonb("old_values").notNull(),
    newValues: jsonb("new_values").notNull(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("modification_requests_branch_idx").on(table.branchId),
    index("modification_requests_profile_idx").on(table.familyProfileId),
    index("modification_requests_status_idx").on(table.status),
    index("modification_requests_created_idx").on(table.createdAt),
    check(
      "modification_requests_review_consistency_chk",
      sql`
        CASE
          WHEN ${table.status} IN ('approved','rejected')
          THEN ${table.reviewedAt} IS NOT NULL AND ${table.reviewedByUserId} IS NOT NULL
          ELSE TRUE
        END
      `,
    ),
    check(
      "modification_requests_rejection_reason_chk",
      sql`
        CASE
          WHEN ${table.status} = 'rejected'
          THEN ${table.rejectionReason} IS NOT NULL AND length(trim(${table.rejectionReason})) > 0
          ELSE TRUE
        END
      `,
    ),
  ],
);

export const familyMemberRequests = pgTable(
  "family_member_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyProfileId: uuid("family_profile_id")
      .notNull()
      .references(() => familyProfiles.id, { onDelete: "restrict" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    requestedNationalId: varchar("requested_national_id", { length: 20 }).notNull(),
    status: reviewStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload").notNull(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("family_member_requests_profile_idx").on(table.familyProfileId),
    index("family_member_requests_branch_idx").on(table.branchId),
    index("family_member_requests_status_idx").on(table.status),
    index("family_member_requests_nid_idx").on(table.requestedNationalId),
    check("family_member_requests_nid_format_chk", sql`${table.requestedNationalId} ~ '^[0-9]{6,20}$'`),
    check(
      "family_member_requests_review_consistency_chk",
      sql`
        CASE
          WHEN ${table.status} IN ('approved','rejected')
          THEN ${table.reviewedAt} IS NOT NULL AND ${table.reviewedByUserId} IS NOT NULL
          ELSE TRUE
        END
      `,
    ),
    check(
      "family_member_requests_rejection_reason_chk",
      sql`
        CASE
          WHEN ${table.status} = 'rejected'
          THEN ${table.rejectionReason} IS NOT NULL AND length(trim(${table.rejectionReason})) > 0
          ELSE TRUE
        END
      `,
    ),
  ],
);

export const news = pgTable(
  "news",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    body: text("body").notNull(),
    externalUrl: varchar("external_url", { length: 1024 }),
    imagePath: text("image_path"),
    status: newsStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expireAt: timestamp("expire_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("news_status_idx").on(table.status),
    index("news_expire_idx").on(table.expireAt),
    index("news_published_idx").on(table.publishedAt),
    check("news_expire_after_publish_chk", sql`${table.expireAt} IS NULL OR ${table.publishedAt} IS NULL OR ${table.expireAt} >= ${table.publishedAt}`),
  ],
);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: announcementTypeEnum("type").notNull(),
    status: announcementStatusEnum("status").notNull().default("draft"),
    title: varchar("title", { length: 220 }).notNull(),
    body: text("body").notNull(),
    relatedPersonId: uuid("related_person_id").references(() => people.id, { onDelete: "set null" }),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expireAt: timestamp("expire_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("announcements_status_idx").on(table.status),
    index("announcements_publish_idx").on(table.publishAt),
    index("announcements_expire_idx").on(table.expireAt),
    check(
      "announcements_expire_after_publish_chk",
      sql`${table.expireAt} IS NULL OR ${table.publishAt} IS NULL OR ${table.expireAt} >= ${table.publishAt}`,
    ),
  ],
);

export const archivePosts = pgTable(
  "archive_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 220 }).notNull(),
    summary: text("summary").notNull(),
    publishDate: date("publish_date").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("archive_posts_publish_date_idx").on(table.publishDate)],
);

export const archiveImages = pgTable(
  "archive_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    archivePostId: uuid("archive_post_id")
      .notNull()
      .references(() => archivePosts.id, { onDelete: "restrict" }),
    storagePath: text("storage_path").notNull(),
    visibility: storageVisibilityEnum("visibility").notNull().default("private"),
    altText: varchar("alt_text", { length: 220 }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("archive_images_post_idx").on(table.archivePostId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    channel: notificationChannelEnum("channel").notNull().default("in_app"),
    type: varchar("type", { length: 80 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_user_idx").on(table.recipientUserId), index("notifications_read_idx").on(table.readAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRoleCode: roleCodeEnum("actor_role_code"),
    action: varchar("action", { length: 120 }).notNull(),
    targetTable: varchar("target_table", { length: 120 }).notNull(),
    targetId: varchar("target_id", { length: 120 }),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorUserId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);

export const otpVerifications = pgTable(
  "otp_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: varchar("phone", { length: 10 }).notNull(),
    purpose: otpPurposeEnum("purpose").notNull(),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    resendCount: integer("resend_count").notNull().default(1),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("otp_phone_purpose_idx").on(table.phone, table.purpose),
    uniqueIndex("otp_active_unique_idx").on(table.phone, table.purpose).where(sql`${table.consumedAt} IS NULL`),
    check("otp_phone_format_chk", sql`${table.phone} ~ '^[0-9]{10}$'`),
    check("otp_attempt_bounds_chk", sql`${table.attempts} >= 0 AND ${table.maxAttempts} >= 1 AND ${table.attempts} <= ${table.maxAttempts}`),
    check("otp_resend_count_chk", sql`${table.resendCount} >= 1`),
    check("otp_expiry_after_create_chk", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const importExportBatches = pgTable(
  "import_export_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operation: importExportOperationEnum("operation").notNull(),
    scopeBranchId: integer("scope_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    initiatedByUserId: uuid("initiated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    fileName: varchar("file_name", { length: 255 }),
    filters: jsonb("filters"),
    status: batchStatusEnum("status").notNull().default("pending"),
    totalRows: integer("total_rows").notNull().default(0),
    successRows: integer("success_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("import_export_batches_status_idx").on(table.status),
    index("import_export_batches_branch_idx").on(table.scopeBranchId),
    index("import_export_batches_operation_idx").on(table.operation),
    check("import_export_counts_chk", sql`${table.totalRows} >= 0 AND ${table.successRows} >= 0 AND ${table.failedRows} >= 0`),
  ],
);

export const importErrors = pgTable(
  "import_errors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importExportBatchId: uuid("import_export_batch_id")
      .notNull()
      .references(() => importExportBatches.id, { onDelete: "restrict" }),
    rowNumber: integer("row_number").notNull(),
    field: varchar("field", { length: 100 }).notNull(),
    value: text("value"),
    errorMessage: text("error_message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("import_errors_batch_idx").on(table.importExportBatchId)],
);
