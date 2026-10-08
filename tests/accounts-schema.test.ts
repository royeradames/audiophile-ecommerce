import assert from "node:assert/strict";
import test from "node:test";
import { createFederatedAuth } from "@royer/auth/federation";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";
import { startTestDatabase } from "./support/database.ts";

// The reviewed migrations must give the vendored @royer/auth central adapter every
// table and column it uses. rc.5 added federationTransaction.completedSessionId and
// .claims; without them every federated sign-in fails.
test("the reviewed migrations match the vendored account adapter's schema", async () => {
  const database = await startTestDatabase();
  const pool = new pg.Pool({ connectionString: database.url, max: 1 });
  try {
    const auth = createFederatedAuth({
      appId: "audiophile",
      appName: "Audiophile",
      baseURL: "https://audiophile.example",
      secret: "schema-test-only-secret-0123456789abcdef",
      database: pool,
      issuerURL: "https://issuer.example/api/auth",
      clientId: "schema-test-only",
      clientSecret: "schema-test-only",
    });
    const plan = await getMigrations(auth.engine.options);
    assert.deepEqual(plan.toBeCreated.map((table) => table.table), [], "tables the migrations do not create");
    assert.deepEqual(
      plan.toBeAdded.map((table) => ({ table: table.table, columns: Object.keys(table.fields) })),
      [],
      "columns the migrations do not add",
    );
  } finally {
    await pool.end();
    await database.close();
  }
});
