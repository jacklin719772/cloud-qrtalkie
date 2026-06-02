ALTER TABLE gate_devices
  ADD COLUMN expires_at TIMESTAMP NULL AFTER assigned_at;

ALTER TABLE gate_device_assignment_history
  ADD COLUMN expires_at TIMESTAMP NULL AFTER to_status;
