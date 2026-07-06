-- Migration: 066_push_gateway_routing

ALTER TABLE push_devices
  ADD COLUMN device_key VARCHAR(512) NOT NULL DEFAULT '' AFTER id,
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL AFTER device_key,
  ADD COLUMN sip_user_id BIGINT UNSIGNED NULL AFTER tenant_id,
  ADD COLUMN app_region VARCHAR(32) NOT NULL DEFAULT '' AFTER sip_instance,
  ADD COLUMN package_name VARCHAR(255) NOT NULL DEFAULT '' AFTER app_region,
  ADD COLUMN manufacturer VARCHAR(80) NOT NULL DEFAULT '' AFTER package_name,
  ADD COLUMN has_gms TINYINT(1) NULL DEFAULT NULL AFTER manufacturer,
  ADD COLUMN preferred_push_provider VARCHAR(32) NOT NULL DEFAULT '' AFTER has_gms,
  ADD COLUMN fcm_token TEXT NULL AFTER token,
  ADD COLUMN jpush_registration_id TEXT NULL AFTER fcm_token,
  ADD COLUMN apns_token TEXT NULL AFTER jpush_registration_id,
  ADD COLUMN voip_token TEXT NULL AFTER apns_token,
  ADD COLUMN last_seen_ip VARCHAR(80) NOT NULL DEFAULT '' AFTER voip_token,
  ADD COLUMN last_seen_country VARCHAR(80) NOT NULL DEFAULT '' AFTER last_seen_ip,
  ADD KEY idx_push_devices_tenant_id (tenant_id),
  ADD KEY idx_push_devices_sip_user_id (sip_user_id),
  ADD KEY idx_push_devices_app_region (app_region),
  ADD KEY idx_push_devices_package_name (package_name),
  ADD KEY idx_push_devices_preferred_provider (preferred_push_provider),
  ADD KEY idx_push_devices_manufacturer (manufacturer);

UPDATE push_devices
   SET device_key = CASE
     WHEN device_key IS NOT NULL AND device_key <> '' THEN device_key
     WHEN device_id IS NOT NULL AND device_id <> '' THEN CONCAT('device:', device_id)
     ELSE CONCAT('legacy:', id)
   END;

ALTER TABLE push_devices
  ADD UNIQUE KEY uq_push_devices_device_key (device_key);
