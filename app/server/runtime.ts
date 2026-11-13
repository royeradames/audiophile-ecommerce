import type { FederatedAuth } from "@royer/auth/federation";
import type pg from "pg";
import { DEMO_STORE } from "../demo-store";
import type { StoreFeatures } from "../order-api";
import { getAccounts, currentCustomer, type CustomerCheck } from "./accounts";
import { getDatabase } from "./database";

export type { CustomerCheck };

/**
 * The durable store and customer accounts for this deployment. The Sites
 * fallback build swaps this module for `runtime.sites.ts`, which has neither,
 * so PostgreSQL and the account package never enter the Worker bundle.
 */
export function serverRuntime(): { db: pg.Pool; accounts: FederatedAuth | null } | null {
  const db = getDatabase();
  if (!db) return null;
  return { db, accounts: getAccounts(db) };
}

export function storeFeatures(): StoreFeatures {
  const runtime = serverRuntime();
  return {
    demo: DEMO_STORE,
    durableOrders: runtime !== null,
    accounts: runtime?.accounts ? "enabled" : "coming_soon",
  };
}

export function customerFor(runtime: { accounts: FederatedAuth | null }, headers: Headers): Promise<CustomerCheck> {
  return currentCustomer(runtime.accounts, headers);
}
