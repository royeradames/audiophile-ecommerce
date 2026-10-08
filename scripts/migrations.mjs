// Reviewed, idempotent schema migrations. Each file in migrations/ runs once,
// in name order, inside one transaction, and is recorded with its SHA-256.
// A recorded file whose contents later change stops the run: edit by adding a
// new file, never by rewriting an applied one.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const directory = new URL("../migrations/", import.meta.url);

export async function readMigrations() {
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(name, directory), "utf8");
    return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  }));
}

/** One hash over every file name and content, for the reviewer to approve. */
export function combinedHash(migrations) {
  const hash = createHash("sha256");
  for (const migration of migrations) hash.update(migration.name + "\n" + migration.sha256 + "\n");
  return hash.digest("hex");
}

/** Applies pending migrations with `client` (a pg client or pool connection). */
export async function applyMigrations(client, migrations) {
  const applied = [], skipped = [];
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(1966012807)");
    await client.query(`create table if not exists "audiophile_schema_migrations" (
      "name" text primary key, "sha256" text not null, "applied_at" timestamptz not null default now())`);
    const { rows } = await client.query(`select "name", "sha256" from "audiophile_schema_migrations"`);
    const recorded = new Map(rows.map((row) => [row.name, row.sha256]));
    for (const migration of migrations) {
      const previous = recorded.get(migration.name);
      if (previous === migration.sha256) { skipped.push(migration.name); continue; }
      if (previous) throw new Error(`Migration ${migration.name} changed after it was applied.`);
      await client.query(migration.sql);
      await client.query(`insert into "audiophile_schema_migrations" ("name", "sha256") values ($1, $2)`,
        [migration.name, migration.sha256]);
      applied.push(migration.name);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  return { applied, skipped };
}
