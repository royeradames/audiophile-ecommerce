import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

/**
 * A disposable in-memory PostgreSQL reached through the real `pg` driver, so
 * route code runs exactly as it does against Neon. PGlite is a single
 * session, so the app's pool is limited to one connection.
 */
export async function startTestDatabase() {
  const database = await PGlite.create();
  // Two sockets so a restarted pool can connect while the old socket is still
  // closing. The app's pool uses one at a time, so queries never interleave.
  const server = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0, maxConnections: 2 });
  await server.start();
  const url = `postgresql://postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  const previous = { url: process.env.DATABASE_URL, max: process.env.DATABASE_POOL_MAX };
  process.env.DATABASE_URL = url;
  process.env.DATABASE_POOL_MAX = "1";

  const migrations = await import("../../scripts/migrations.mjs").catch(() => null);
  if (migrations) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await migrations.applyMigrations(client, await migrations.readMigrations());
    } finally {
      await client.end();
    }
  }

  return {
    url,
    /** Runs one query through the app's own pool, between app requests. */
    async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
      const { getDatabase } = await import("../../app/server/database.ts");
      const pool = getDatabase();
      if (!pool) throw new Error("The test database is not configured.");
      return pool.query<T>(text, values);
    },
    async close() {
      await simulateRestart();
      await server.stop();
      await database.close();
      process.env.DATABASE_URL = previous.url;
      process.env.DATABASE_POOL_MAX = previous.max;
      if (previous.url === undefined) delete process.env.DATABASE_URL;
      if (previous.max === undefined) delete process.env.DATABASE_POOL_MAX;
    },
  };
}

/**
 * What a server restart or a new serverless instance does to this process:
 * every in-memory record and open connection is gone. Only the database stays.
 */
export async function simulateRestart() {
  const memory = globalThis as Record<string, unknown>;
  for (const key of Object.keys(memory).filter((name) => name.startsWith("__audiophile"))) {
    const value = memory[key] as { end?: () => Promise<void> } | undefined;
    delete memory[key];
    if (typeof value?.end === "function") await value.end();
  }
}
