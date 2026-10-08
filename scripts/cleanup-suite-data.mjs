// Removes the hosted suites' synthetic data: orders placed by reserved
// suite-*@example.test buyers, plus audiophile-suite- accounts (and their
// orders) in this app's database and, when given, the issuer preview's.
// Prints counts only, never connection details.
import pg from "pg";

const buyers = "suite-%@example.test";
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
    `delete from "audiophile_orders" where "email" like $1
       or "customer_id" in (select "id" from "user" where "email" like $2) returning "id"`,
    [buyers, accounts],
  );
  // Items and payments cascade; webhook receipts name the order without a key.
  await pool.query(`delete from "audiophile_stripe_events" where "order_id" = any($1::text[])`, [orders.rows.map((row) => row.id)]);
  const users = await pool.query(`delete from "user" where "email" like $1`, [accounts]);
  const left = await pool.query(
    `select (select count(*)::int from "audiophile_orders" where "email" like $1) as "orders",
            (select count(*)::int from "user" where "email" like $2) as "users"`,
    [buyers, accounts],
  );
  console.log(`audiophile: removed ${orders.rowCount} orders and ${users.rowCount} accounts; remaining ${JSON.stringify(left.rows[0])}`);
  if (left.rows[0].orders || left.rows[0].users) failed = true;
});

if (process.env.ISSUER_DATABASE_URL || process.argv.includes("--issuer")) {
  await withPool("issuer", process.env.ISSUER_DATABASE_URL, async (pool) => {
    const removed = await pool.query(`delete from "user" where "email" like $1`, [accounts]);
    const left = await pool.query(`select count(*)::int as "count" from "user" where "email" like $1`, [accounts]);
    console.log(`issuer: removed ${removed.rowCount}, remaining ${left.rows[0].count}`);
    if (left.rows[0].count) failed = true;
  });
}

process.exitCode = failed ? 1 : 0;
