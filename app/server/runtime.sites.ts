import type { FederatedAuth } from "@royer/auth/federation";
import type pg from "pg";
import { DEMO_STORE } from "../demo-store";
import type { StoreFeatures } from "../order-api";

// The owner-only Sites fallback stays guest-only: orders live in the browser
// and nothing is stored on the server. Same exports as runtime.ts.
export type CustomerCheck =
  | { state: "signed_in"; id: string; name: string; email: string }
  | { state: "signed_out" }
  | { state: "unavailable" };

export function serverRuntime(): { db: pg.Pool; accounts: FederatedAuth | null } | null {
  return null;
}

export function storeFeatures(): StoreFeatures {
  return { demo: DEMO_STORE, durableOrders: false, accounts: "coming_soon" };
}

export async function customerFor(): Promise<CustomerCheck> {
  return { state: "signed_out" };
}
