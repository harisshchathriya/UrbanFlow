-- Ensure driver live tracking columns exist
alter table drivers
  add column if not exists current_latitude double precision,
  add column if not exists current_longitude double precision,
  add column if not exists current_delivery_id uuid,
  add column if not exists status text default 'idle',
  add column if not exists last_location_updated_at timestamp;

-- Ensure deliveries core columns exist
alter table deliveries
  add column if not exists driver_id uuid,
  add column if not exists status text,
  add column if not exists from_lat double precision,
  add column if not exists from_lng double precision,
  add column if not exists to_lat double precision,
  add column if not exists to_lng double precision;
