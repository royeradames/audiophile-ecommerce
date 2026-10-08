// Applies the reviewed migrations to one named Neon database.
//
//   vercel env run -e preview -- node scripts/migrate.mjs \
//     --neon-project=<NEON_PROJECT_ID> --reviewed-sha256=<combined hash> [--through=<file>]
//
// Run `node scripts/migrate.mjs --plan` first to print the combined hash for
// review. Output holds names and hashes only, never connection details.
import pg from "pg";
import { applyMigrations, combinedHash, readMigrations } from "./migrations.mjs";

const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
// --through=<file> stops after that file, for expand/contract releases:
// apply the expand step, ship the code, then apply the rest.
const through = option("through");
const all = await readMigrations();
if (through && !all.some((migration) => migration.name === through)) throw new Error(`No migration named ${through}.`);
const migrations = through ? all.slice(0, all.findIndex((migration) => migration.name === through) + 1) : all;
const hash = combinedHash(migrations);

if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ planned: migrations.map(({ name, sha256 }) => ({ name, sha256 })), combinedSHA256: hash }, null, 2));
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString || new URL(connectionString).hostname.includes("-pooler")) {
  throw new Error("Use the direct (unpooled) connection for migrations.");
}
if (!option("neon-project") || option("neon-project") !== process.env.NEON_PROJECT_ID) {
  throw new Error("Name the target with --neon-project; it must match this environment's NEON_PROJECT_ID.");
}
if (option("reviewed-sha256") !== hash) {
  throw new Error("Supply the reviewed combined SHA-256 from --plan.");
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  const result = await applyMigrations(client, migrations);
  console.log(JSON.stringify({ target: process.env.NEON_PROJECT_ID, combinedSHA256: hash, ...result }));
} catch (error) {
  // SQL errors name the statement problem; connection errors could name hosts.
  const sqlState = error && typeof error === "object" && "code" in error && /^[0-9A-Z]{5}$/.test(String(error.code));
  const reason = sqlState || String(error?.message).startsWith("Migration ")
    ? String(error.message).slice(0, 200) : "connection or runtime failure";
  console.error(JSON.stringify({ failed: true, rolledBack: true, reason }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
