-- Links an order to the customer's local principal. Deleting a customer keeps
-- their orders as guest orders. Added once; a rerun leaves it unchanged.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audiophile_orders_customer_fk'
  ) then
    alter table "audiophile_orders"
      add constraint "audiophile_orders_customer_fk"
      foreign key ("customer_id") references "user" ("id") on delete set null;
  end if;
end
$$;
