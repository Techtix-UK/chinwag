-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `timezone` VARCHAR(64) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(512) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `description` VARCHAR(512) NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,

    INDEX `user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` VARCHAR(191) NOT NULL,
    `permission_id` VARCHAR(191) NOT NULL,

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_account_permissions` (
    `user_id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `level` ENUM('READ', 'SEND', 'MANAGE') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_account_permissions_account_id_idx`(`account_id`),
    PRIMARY KEY (`user_id`, `account_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `csrf_token` CHAR(64) NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_sessions_token_hash_key`(`token_hash`),
    INDEX `user_sessions_user_id_idx`(`user_id`),
    INDEX `user_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(128) NOT NULL,
    `phone_number` VARCHAR(32) NULL,
    `wa_id` VARCHAR(128) NULL,
    `profile_name` VARCHAR(191) NULL,
    `profile_pic_url` TEXT NULL,
    `platform` VARCHAR(64) NULL,
    `status` ENUM('INITIALISING', 'AWAITING_QR', 'AUTHENTICATING', 'SYNCHRONISING', 'CONNECTED', 'DISCONNECTED', 'RECONNECTING', 'AUTH_FAILED', 'SESSION_EXPIRED', 'LOGGED_OUT', 'ERROR') NOT NULL DEFAULT 'DISCONNECTED',
    `status_detail` VARCHAR(512) NULL,
    `desired_state` ENUM('CONNECTED', 'DISCONNECTED') NOT NULL DEFAULT 'DISCONNECTED',
    `last_connected_at` DATETIME(3) NULL,
    `last_disconnected_at` DATETIME(3) NULL,
    `last_sync_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_sessions` (
    `account_id` VARCHAR(191) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL,
    `auth_path` VARCHAR(512) NOT NULL,
    `wweb_version` VARCHAR(32) NULL,
    `reconnect_attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `last_qr_at` DATETIME(3) NULL,
    `last_ready_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_sessions_client_id_key`(`client_id`),
    PRIMARY KEY (`account_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacts` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `wa_id` VARCHAR(128) NOT NULL,
    `phone_number` VARCHAR(32) NULL,
    `display_name` VARCHAR(191) NULL,
    `profile_name` VARCHAR(191) NULL,
    `profile_pic_url` TEXT NULL,
    `is_business` BOOLEAN NOT NULL DEFAULT false,
    `is_enterprise` BOOLEAN NOT NULL DEFAULT false,
    `is_my_contact` BOOLEAN NOT NULL DEFAULT false,
    `is_group` BOOLEAN NOT NULL DEFAULT false,
    `is_blocked` BOOLEAN NOT NULL DEFAULT false,
    `last_interaction_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `contacts_account_id_display_name_idx`(`account_id`, `display_name`),
    INDEX `contacts_account_id_phone_number_idx`(`account_id`, `phone_number`),
    UNIQUE INDEX `contacts_account_id_wa_id_key`(`account_id`, `wa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_notes` (
    `id` VARCHAR(191) NOT NULL,
    `contact_id` VARCHAR(191) NOT NULL,
    `author_id` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_notes_contact_id_idx`(`contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_tags` (
    `contact_id` VARCHAR(191) NOT NULL,
    `tag` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_tags_tag_idx`(`tag`),
    PRIMARY KEY (`contact_id`, `tag`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chats` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `wa_chat_id` VARCHAR(128) NOT NULL,
    `name` VARCHAR(191) NULL,
    `is_group` BOOLEAN NOT NULL DEFAULT false,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `is_muted` BOOLEAN NOT NULL DEFAULT false,
    `is_read_only` BOOLEAN NOT NULL DEFAULT false,
    `unread_count` INTEGER NOT NULL DEFAULT 0,
    `profile_pic_url` TEXT NULL,
    `group_description` TEXT NULL,
    `group_owner` VARCHAR(128) NULL,
    `group_created_at` DATETIME(3) NULL,
    `last_message_at` DATETIME(3) NULL,
    `last_message_preview` VARCHAR(255) NULL,
    `last_message_from_me` BOOLEAN NULL,
    `sync_state` ENUM('FULL', 'PARTIAL', 'UNAVAILABLE') NOT NULL DEFAULT 'UNAVAILABLE',
    `synced_message_count` INTEGER NOT NULL DEFAULT 0,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chats_account_id_last_message_at_idx`(`account_id`, `last_message_at`),
    INDEX `chats_account_id_unread_count_idx`(`account_id`, `unread_count`),
    INDEX `chats_account_id_name_idx`(`account_id`, `name`),
    UNIQUE INDEX `chats_account_id_wa_chat_id_key`(`account_id`, `wa_chat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_participants` (
    `chat_id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `wa_id` VARCHAR(128) NOT NULL,
    `is_admin` BOOLEAN NOT NULL DEFAULT false,
    `is_super_admin` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `group_participants_account_id_idx`(`account_id`),
    PRIMARY KEY (`chat_id`, `wa_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `chat_id` VARCHAR(191) NOT NULL,
    `wa_message_id` VARCHAR(255) NOT NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `type` VARCHAR(48) NOT NULL,
    `body` TEXT NULL,
    `sender_wa_id` VARCHAR(128) NULL,
    `sender_name` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'PLAYED', 'FAILED', 'RECEIVED') NOT NULL DEFAULT 'RECEIVED',
    `ack` INTEGER NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `has_media` BOOLEAN NOT NULL DEFAULT false,
    `quoted_wa_message_id` VARCHAR(255) NULL,
    `quoted_body` VARCHAR(512) NULL,
    `is_forwarded` BOOLEAN NOT NULL DEFAULT false,
    `is_edited` BOOLEAN NOT NULL DEFAULT false,
    `edited_at` DATETIME(3) NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `deleted_at` DATETIME(3) NULL,
    `location_lat` DOUBLE NULL,
    `location_lng` DOUBLE NULL,
    `location_name` VARCHAR(255) NULL,
    `sent_by_user_id` VARCHAR(191) NULL,
    `sent_via` VARCHAR(32) NULL,
    `error_detail` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `messages_chat_id_timestamp_idx`(`chat_id`, `timestamp`),
    INDEX `messages_account_id_timestamp_idx`(`account_id`, `timestamp`),
    INDEX `messages_account_id_direction_timestamp_idx`(`account_id`, `direction`, `timestamp`),
    UNIQUE INDEX `messages_account_id_wa_message_id_key`(`account_id`, `wa_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `message_id` VARCHAR(191) NULL,
    `original_filename` VARCHAR(255) NULL,
    `storage_path` VARCHAR(512) NULL,
    `mime_type` VARCHAR(128) NOT NULL,
    `size_bytes` INTEGER NULL,
    `checksum` CHAR(64) NULL,
    `state` ENUM('PENDING', 'STORED', 'NOT_DOWNLOADED', 'FAILED', 'DELETED') NOT NULL DEFAULT 'PENDING',
    `source` VARCHAR(32) NOT NULL DEFAULT 'whatsapp',
    `uploaded_by_user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_attachments_account_id_created_at_idx`(`account_id`, `created_at`),
    INDEX `message_attachments_message_id_idx`(`message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_reactions` (
    `id` VARCHAR(191) NOT NULL,
    `message_id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `sender_wa_id` VARCHAR(128) NOT NULL,
    `emoji` VARCHAR(32) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,

    INDEX `message_reactions_account_id_idx`(`account_id`),
    UNIQUE INDEX `message_reactions_message_id_sender_wa_id_key`(`message_id`, `sender_wa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_drafts` (
    `user_id` VARCHAR(191) NOT NULL,
    `chat_id` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`, `chat_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduled_messages` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `recipient_wa_id` VARCHAR(128) NOT NULL,
    `recipient_label` VARCHAR(191) NULL,
    `body` TEXT NULL,
    `attachment_id` VARCHAR(191) NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'AWAITING_APPROVAL', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED', 'EXPIRED', 'DELIVERY_UNCERTAIN') NOT NULL DEFAULT 'PENDING',
    `approval_status` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
    `approval_id` VARCHAR(191) NULL,
    `created_by_type` VARCHAR(32) NOT NULL,
    `created_by_id` VARCHAR(64) NOT NULL,
    `created_by_label` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `error_detail` TEXT NULL,
    `sent_message_id` VARCHAR(255) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scheduled_messages_status_scheduled_at_idx`(`status`, `scheduled_at`),
    INDEX `scheduled_messages_account_id_status_idx`(`account_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `recipient_wa_id` VARCHAR(128) NOT NULL,
    `recipient_label` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `payload_hash` CHAR(64) NOT NULL,
    `scheduled_message_id` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXECUTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `requested_by_type` VARCHAR(32) NOT NULL,
    `requested_by_id` VARCHAR(64) NOT NULL,
    `requested_by_label` VARCHAR(191) NULL,
    `decided_by_user_id` VARCHAR(191) NULL,
    `decision_note` VARCHAR(512) NULL,
    `decided_at` DATETIME(3) NULL,
    `result_message_id` VARCHAR(255) NULL,
    `error_detail` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `message_approvals_status_created_at_idx`(`status`, `created_at`),
    INDEX `message_approvals_account_id_status_idx`(`account_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `prefix` VARCHAR(32) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `scopes` JSON NOT NULL,
    `account_ids` JSON NOT NULL,
    `all_accounts` BOOLEAN NOT NULL DEFAULT false,
    `approval_policy` ENUM('READ_ONLY', 'REQUIRE_APPROVAL', 'DIRECT') NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    `expires_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `last_used_ip` VARCHAR(64) NULL,
    `revoked_at` DATETIME(3) NULL,
    `rotated_from_id` VARCHAR(191) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `api_keys_prefix_key`(`prefix`),
    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_clients` (
    `id` VARCHAR(191) NOT NULL,
    `client_id` VARCHAR(255) NOT NULL,
    `client_secret_enc` TEXT NULL,
    `client_secret_expires_at` INTEGER NULL,
    `client_name` VARCHAR(255) NULL,
    `client_uri` VARCHAR(512) NULL,
    `logo_uri` VARCHAR(512) NULL,
    `redirect_uris` JSON NOT NULL,
    `grant_types` JSON NOT NULL,
    `response_types` JSON NOT NULL,
    `token_endpoint_auth_method` VARCHAR(64) NOT NULL DEFAULT 'none',
    `scope` VARCHAR(1024) NULL,
    `registration_type` VARCHAR(32) NOT NULL DEFAULT 'dynamic',
    `metadata` JSON NULL,
    `disabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `oauth_clients_client_id_key`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_authorization_requests` (
    `id` CHAR(43) NOT NULL,
    `client_id` VARCHAR(255) NOT NULL,
    `redirect_uri` TEXT NOT NULL,
    `code_challenge` VARCHAR(128) NOT NULL,
    `state` TEXT NULL,
    `scopes` JSON NOT NULL,
    `resource` VARCHAR(512) NULL,
    `user_id` VARCHAR(191) NULL,
    `consumed_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oauth_authorization_requests_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_authorisations` (
    `id` VARCHAR(191) NOT NULL,
    `client_db_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `scopes` JSON NOT NULL,
    `account_ids` JSON NOT NULL,
    `approval_policy` ENUM('READ_ONLY', 'REQUIRE_APPROVAL', 'DIRECT') NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    `last_used_at` DATETIME(3) NULL,
    `last_error` VARCHAR(512) NULL,
    `last_error_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `oauth_authorisations_client_db_id_idx`(`client_db_id`),
    INDEX `oauth_authorisations_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `authorisation_id` VARCHAR(191) NOT NULL,
    `type` ENUM('AUTHORIZATION_CODE', 'ACCESS', 'REFRESH') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `scopes` JSON NOT NULL,
    `resource` VARCHAR(512) NULL,
    `code_challenge` VARCHAR(128) NULL,
    `redirect_uri` TEXT NULL,
    `parent_id` VARCHAR(191) NULL,
    `used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_tokens_token_hash_key`(`token_hash`),
    INDEX `oauth_tokens_authorisation_id_type_idx`(`authorisation_id`, `type`),
    INDEX `oauth_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` VARCHAR(191) NOT NULL,
    `principal` VARCHAR(96) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `state` VARCHAR(16) NOT NULL,
    `status_code` INTEGER NULL,
    `response` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idempotency_keys_created_at_idx`(`created_at`),
    UNIQUE INDEX `idempotency_keys_principal_key_key`(`principal`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhooks` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `url` VARCHAR(1024) NOT NULL,
    `events` JSON NOT NULL,
    `account_ids` JSON NOT NULL,
    `all_accounts` BOOLEAN NOT NULL DEFAULT true,
    `secret_enc` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `webhook_id` VARCHAR(191) NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `event_id` VARCHAR(64) NOT NULL,
    `account_id` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED', 'RETRYING') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `response_status` INTEGER NULL,
    `response_body` VARCHAR(1024) NULL,
    `error_detail` VARCHAR(1024) NULL,
    `duration_ms` INTEGER NULL,
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_deliveries_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `webhook_deliveries_webhook_id_created_at_idx`(`webhook_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action` VARCHAR(96) NOT NULL,
    `actor_type` VARCHAR(32) NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `actor_label` VARCHAR(191) NULL,
    `source` VARCHAR(32) NOT NULL,
    `account_id` VARCHAR(32) NULL,
    `result` VARCHAR(16) NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `metadata` JSON NULL,

    INDEX `audit_logs_timestamp_idx`(`timestamp`),
    INDEX `audit_logs_action_timestamp_idx`(`action`, `timestamp`),
    INDEX `audit_logs_account_id_timestamp_idx`(`account_id`, `timestamp`),
    INDEX `audit_logs_actor_id_timestamp_idx`(`actor_id`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_events` (
    `id` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `level` VARCHAR(16) NOT NULL,
    `component` VARCHAR(64) NOT NULL,
    `account_id` VARCHAR(32) NULL,
    `message` VARCHAR(1024) NOT NULL,
    `detail` JSON NULL,

    INDEX `system_events_timestamp_idx`(`timestamp`),
    INDEX `system_events_level_timestamp_idx`(`level`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `application_settings` (
    `key` VARCHAR(96) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_account_permissions` ADD CONSTRAINT `user_account_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_account_permissions` ADD CONSTRAINT `user_account_permissions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsapp_sessions` ADD CONSTRAINT `whatsapp_sessions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_notes` ADD CONSTRAINT `contact_notes_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_tags` ADD CONSTRAINT `contact_tags_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chats` ADD CONSTRAINT `chats_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_participants` ADD CONSTRAINT `group_participants_chat_id_fkey` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_chat_id_fkey` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_attachments` ADD CONSTRAINT `message_attachments_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_attachments` ADD CONSTRAINT `message_attachments_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reactions` ADD CONSTRAINT `message_reactions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_drafts` ADD CONSTRAINT `message_drafts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_drafts` ADD CONSTRAINT `message_drafts_chat_id_fkey` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scheduled_messages` ADD CONSTRAINT `scheduled_messages_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_approvals` ADD CONSTRAINT `message_approvals_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_authorization_requests` ADD CONSTRAINT `oauth_authorization_requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_authorisations` ADD CONSTRAINT `oauth_authorisations_client_db_id_fkey` FOREIGN KEY (`client_db_id`) REFERENCES `oauth_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_authorisations` ADD CONSTRAINT `oauth_authorisations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_tokens` ADD CONSTRAINT `oauth_tokens_authorisation_id_fkey` FOREIGN KEY (`authorisation_id`) REFERENCES `oauth_authorisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
