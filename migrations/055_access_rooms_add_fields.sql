ALTER TABLE access_rooms
  ADD COLUMN floor VARCHAR(50) NULL AFTER room_number,
  ADD COLUMN contact_person VARCHAR(120) NULL AFTER floor,
  ADD COLUMN contact_phone VARCHAR(40) NULL AFTER contact_person,
  ADD COLUMN contact_email VARCHAR(255) NULL AFTER contact_phone;
