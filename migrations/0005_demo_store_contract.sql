-- Demo store, step 2 of 2 (contract). Applied only AFTER production serves
-- the demo-store code, which never reads or writes these columns. The store
-- then keeps no name, email, phone, address or country: nothing is sold, and
-- tax is the same demo 18% for every order. Safe to run again.
-- After this step, rolling back to code older than the demo store breaks
-- order reads; roll forward instead.
alter table "audiophile_orders"
  drop column if exists "customer_name",
  drop column if exists "email",
  drop column if exists "phone",
  drop column if exists "address",
  drop column if exists "zip",
  drop column if exists "city",
  drop column if exists "country";
