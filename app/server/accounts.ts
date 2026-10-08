import { AuthenticationUnavailableError, createFederatedAuth, type FederatedAuth } from "@royer/auth/federation";
import { getVercelOidcToken } from "@vercel/functions/oidc";
import type pg from "pg";

export class AccountUnavailable extends Error {}

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

// An exact origin: HTTPS, or HTTP on loopback for local development.
function exactOrigin(value: string) {
  const url = new URL(value);
  const loopback = loopbackHosts.includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new AccountUnavailable("Account addresses must be exact HTTPS origins, or local development origins.");
  }
  return url;
}

/**
 * Customer accounts use the central Breakthrough account. They switch on only
 * where the issuer registered this deployment's exact address: today that is
 * the protected Preview. Production shows "accounts coming soon" until the
 * issuer has a production deployment.
 */
export function accountSettings() {
  const env = process.env;
  const names = ["AUTH_BASE_URL", "AUTH_SECRET", "AUTH_ISSUER_URL", "AUTH_CLIENT_ID", "AUTH_CLIENT_SECRET"] as const;
  if (names.some((name) => !env[name]?.trim())) return null;
  const base = exactOrigin(env.AUTH_BASE_URL!);
  const issuer = exactOrigin(env.AUTH_ISSUER_URL!);
  if (base.pathname !== "/" || env.AUTH_SECRET!.length < 32) {
    throw new AccountUnavailable("Customer account settings are incomplete.");
  }
  if (issuer.pathname !== "/api/auth" || issuer.href !== env.AUTH_ISSUER_URL) {
    throw new AccountUnavailable("The account issuer must be its exact origin plus /api/auth.");
  }
  return {
    baseURL: base.origin,
    secret: env.AUTH_SECRET!,
    issuerURL: issuer.href,
    clientId: env.AUTH_CLIENT_ID!,
    clientSecret: env.AUTH_CLIENT_SECRET!,
  };
}

/**
 * The Preview issuer sits behind Vercel Deployment Protection. Its Trusted
 * Sources rule admits this project's Preview deployments, which prove
 * themselves with a fresh Vercel OIDC token on every issuer request.
 */
async function trustedSourceHeaders() {
  const token = await getVercelOidcToken();
  if (!token) throw new AccountUnavailable("Account access is unavailable.");
  return { "x-vercel-trusted-oidc-idp-token": token };
}

export function configureAccounts(database: pg.Pool, settings: NonNullable<ReturnType<typeof accountSettings>>) {
  const onVercel = process.env.VERCEL === "1";
  return createFederatedAuth({
    appId: "audiophile",
    appName: "Audiophile",
    ...settings,
    database,
    ...(onVercel
      ? { issuerRequestHeaders: trustedSourceHeaders, ipAddress: { headers: ["x-vercel-forwarded-for"] } }
      : {}),
  });
}

declare global {
  var __audiophileAccounts: FederatedAuth | undefined;
}

export function getAccounts(database: pg.Pool | null): FederatedAuth | null {
  if (!database) return null;
  const settings = accountSettings();
  if (!settings) return null;
  globalThis.__audiophileAccounts ??= configureAccounts(database, settings);
  return globalThis.__audiophileAccounts;
}

export type CustomerCheck =
  | { state: "signed_in"; id: string; name: string; email: string }
  | { state: "signed_out" }
  | { state: "unavailable" };

/** The signed-in customer. An unreachable issuer is a retry state, never a guess. */
export async function currentCustomer(accounts: FederatedAuth | null, headers: Headers): Promise<CustomerCheck> {
  if (!accounts) return { state: "signed_out" };
  try {
    const principal = await accounts.getPrincipal(headers);
    return principal
      ? { state: "signed_in", id: principal.id, name: principal.name, email: principal.email }
      : { state: "signed_out" };
  } catch (error) {
    // The issuer, the network or the account tables failed. Report a retry
    // state; never treat a failed check as signed out.
    const reason = error instanceof AuthenticationUnavailableError ? "issuer_unavailable" : "account_check_failed";
    console.error(JSON.stringify({ event: reason }));
    return { state: "unavailable" };
  }
}
