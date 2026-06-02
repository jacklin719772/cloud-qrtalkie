CREATE TABLE IF NOT EXISTS access_communities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_access_communities_tenant (tenant_id),
  CONSTRAINT fk_access_communities_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_buildings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  community_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_access_buildings_tenant (tenant_id),
  KEY idx_access_buildings_community (community_id),
  CONSTRAINT fk_access_buildings_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_buildings_community
    FOREIGN KEY (community_id) REFERENCES access_communities (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  building_id BIGINT UNSIGNED NOT NULL,
  room_number VARCHAR(50) NOT NULL,
  sip_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_rooms_sip_user (sip_user_id),
  KEY idx_access_rooms_tenant (tenant_id),
  KEY idx_access_rooms_building (building_id),
  CONSTRAINT fk_access_rooms_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_rooms_building
    FOREIGN KEY (building_id) REFERENCES access_buildings (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_rooms_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_entrances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  community_id BIGINT UNSIGNED NULL,
  building_id BIGINT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  device_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_entrances_device (device_id),
  KEY idx_access_entrances_tenant (tenant_id),
  KEY idx_access_entrances_community (community_id),
  KEY idx_access_entrances_building (building_id),
  CONSTRAINT fk_access_entrances_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_entrances_community
    FOREIGN KEY (community_id) REFERENCES access_communities (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_entrances_building
    FOREIGN KEY (building_id) REFERENCES access_buildings (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_entrances_device
    FOREIGN KEY (device_id) REFERENCES gate_devices (id)
    ON DELETE SET NULL,
  CONSTRAINT chk_access_entrances_scope
    CHECK ((community_id IS NOT NULL AND building_id IS NULL) OR (community_id IS NULL AND building_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_room_entrance_auth (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  entrance_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_room_entrance_auth (room_id, entrance_id),
  KEY idx_access_room_entrance_auth_tenant (tenant_id),
  KEY idx_access_room_entrance_auth_entrance (entrance_id),
  CONSTRAINT fk_access_room_entrance_auth_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_room_entrance_auth_room
    FOREIGN KEY (room_id) REFERENCES access_rooms (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_access_room_entrance_auth_entrance
    FOREIGN KEY (entrance_id) REFERENCES access_entrances (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
