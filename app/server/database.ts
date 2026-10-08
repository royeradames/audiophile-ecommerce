import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";

declare global {
  var __audiophileDatabase: pg.Pool | undefined;
}

/**
 * The order database, or null when this deployment has none (the guest-only
 * Sites fallback and keyless local runs). Durable orders switch on exactly
 * when DATABASE_URL is set.
 */
export function getDatabase(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  if (!globalThis.__audiophileDatabase) {
    const pool = new pg.Pool({
      connectionString,
      // Tests use a single-session PostgreSQL; production keeps a small pool.
      max: Number(process.env.DATABASE_POOL_MAX) || 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    if (process.env.VERCEL === "1") attachDatabasePool(pool);
    pool.on("error", () => console.error(JSON.stringify({ event: "database_connection_failed" })));
    globalThis.__audiophileDatabase = pool;
  }
  return globalThis.__audiophileDatabase;
}
