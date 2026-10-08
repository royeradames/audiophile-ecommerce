// Removes the hosted suites' synthetic data from this app's database: the
// orders listed in test-results-hosted/created-orders.txt (the store keeps no
// names or emails to match on), plus local audiophile-suite- principals and
// their orders. The issuer's own synthetic accounts belong to the issuer; this
// repository never holds access to its user table.
// Prints counts only, never connection details.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const idsFile = process.argv[2] ?? "test-results-hosted/created-orders.txt";
const accounts = "audiophile-suite-%@sink.accounts-preview.test";
const ids = existsSync(idsFile)
  ? [...new Set(readFileSync(idsFile, "utf8").split("\n").map((line) => line.trim()).filter((id) => /^AUD-[0-9A-HJKMNP-TV-Z]{10}$/.test(id)))]
  : [];
const connectionString = process.env.AUDIOPHILE_DATABASE_URL;
if (!connectionString) {
  console.error("audiophile: database setting missing; nothing removed");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const orders = await pool.query(
    `delete from "audiophile_orders" where "id" = any($1::text[])
       or "customer_id" in (select "id" from "user" where "email" like $2) returning "id"`,
    [ids, accounts],
  );
  // Items, payments and hosted pages cascade; webhook receipts name the order without a key.
  await pool.query(`delete from "audiophile_stripe_events" where "order_id" = any($1::text[])`, [orders.rows.map((row) => row.id)]);
  const users = await pool.query(`delete from "user" where "email" like $1`, [accounts]);
  const left = await pool.query(
    `select (select count(*)::int from "audiophile_orders" where "id" = any($1::text[])) as "orders",
            (select count(*)::int from "user" where "email" like $2) as "users"`,
    [ids, accounts],
  );
  console.log(`audiophile: removed ${orders.rowCount} orders and ${users.rowCount} accounts; remaining ${JSON.stringify(left.rows[0])}`);
  process.exitCode = left.rows[0].orders || left.rows[0].users ? 1 : 0;
} catch {
  console.error("audiophile: cleanup failed; no connection details are logged");
  process.exitCode = 1;
} finally {
  await pool.end();
}
