-- Enforce single active delivery per driver
create or replace function enforce_single_active_delivery()
returns trigger as $$
begin
  if new.status in ('accepted','in_transit') then
    if exists (
      select 1 from deliveries
      where driver_id = new.driver_id
      and status in ('accepted','in_transit')
      and id <> new.id
    ) then
      raise exception 'Driver already has an active delivery';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists check_single_active_delivery on deliveries;
create trigger check_single_active_delivery
before update on deliveries
for each row
execute function enforce_single_active_delivery();

-- Ensure accepted_at exists for atomic accept
alter table deliveries
  add column if not exists accepted_at timestamptz;

-- Atomic accept RPC
create or replace function accept_delivery_atomic(
  p_delivery_id uuid,
  p_driver_id uuid
)
returns deliveries as $$
declare
  updated_row deliveries;
begin
  update deliveries
  set status = 'accepted',
      driver_id = p_driver_id,
      accepted_at = now()
  where id = p_delivery_id
  and status = 'assigned'
  returning * into updated_row;

  if not found then
    raise exception 'Delivery already taken';
  end if;

  return updated_row;
end;
$$ language plpgsql;
