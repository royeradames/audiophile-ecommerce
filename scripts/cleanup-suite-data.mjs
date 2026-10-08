// Removes the hosted suites' synthetic data from this app's database: orders
// marked with the fictional country "Hosted Suite Testland" (the store keeps
// no names or emails to match on), plus local audiophile-suite-
// principals and their orders. The issuer's own synthetic accounts belong to
// the issuer; this repository never holds access to its user table.
// Prints counts only, never connection details.
import pg from "pg";

const suiteCountry = "Hosted Suite Testland";
const accounts = "audiophile-suite-%@sink.accounts-preview.test";
let failed = false;

async function withPool(name, connectionString, work) {
  if (!connectionString) {
    console.error(`${name}: database setting missing; nothing removed`);
    failed = true;
    return;
  }
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await work(pool);
  } catch {
    console.error(`${name}: cleanup failed; no connection details are logged`);
    failed = true;
  } finally {
    await pool.end();
  }
}

await withPool("audiophile", process.env.AUDIOPHILE_DATABASE_URL, async (pool) => {
  const orders = await pool.query(
    `delete from "audiophile_orders" where "country" = $1
       or "customer_id" in (select "id" from "user" where "email" like $2) returning "id"`,
    [suiteCountry, accounts],
  );
  // Items and payments cascade; webhook receipts name the order without a key.
  await pool.query(`delete from "audiophile_stripe_events" where "order_id" = any($1::text[])`, [orders.rows.map((row) => row.id)]);
  const users = await pool.query(`delete from "user" where "email" like $1`, [accounts]);
  const left = await pool.query(
    `select (select count(*)::int from "audiophile_orders" where "country" = $1) as "orders",
            (select count(*)::int from "user" where "email" like $2) as "users"`,
    [suiteCountry, accounts],
  );
  console.log(`audiophile: removed ${orders.rowCount} orders and ${users.rowCount} accounts; remaining ${JSON.stringify(left.rows[0])}`);
  if (left.rows[0].orders || left.rows[0].users) failed = true;
});

process.exitCode = failed ? 1 : 0;
