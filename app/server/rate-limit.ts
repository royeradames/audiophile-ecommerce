import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

/**
 * Fixed ten-minute windows in the database, so every serverless instance
 * shares the count. Addresses and session IDs are stored only as SHA-256
 * buckets, and windows older than a day are deleted by the daily purge.
 */
const WINDOW_SECONDS = 600;
export const limits = {
  ordersPerAddress: 10,
  ordersPerSession: 8,
  paymentStartsPerAddress: 30,
} as const;

export const SESSION_COOKIE = "audiophile_session";

export function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

export function browserSession(request: Request) {
  const match = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const value = match?.slice(SESSION_COOKIE.length + 1) ?? "";
  return /^[A-Za-z0-9_-]{22,64}$/.test(value) ? value : null;
}

/** A new anonymous browser session cookie: random, HttpOnly, one day. */
export function newSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return `${SESSION_COOKIE}=${randomBytes(18).toString("base64url")}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? "; Secure" : ""}`;
}

function bucket(scope: string, id: string) {
  return createHash("sha256").update(`audiophile-rate-limit:${scope}:${id}`).digest("hex");
}

/**
 * Counts one hit against each key. Returns the seconds to wait when any key
 * is over its limit, or null when the request may go ahead.
 */
export async function overLimit(db: pg.Pool, keys: Array<{ scope: string; id: string; limit: number }>) {
  let wait: number | null = null;
  for (const key of keys) {
    const { rows } = await db.query<{ hits: number; reset: number }>(
      `insert into "audiophile_rate_limits" ("bucket", "window_start", "hits")
         values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
       on conflict ("bucket", "window_start") do update set "hits" = "audiophile_rate_limits"."hits" + 1
       returning "hits", ceil($2 - extract(epoch from now()) % $2)::int as "reset"`,
      [bucket(key.scope, key.id), WINDOW_SECONDS],
    );
    if (rows[0].hits > key.limit) wait = Math.max(wait ?? 0, rows[0].reset);
  }
  return wait;
}

export function tooManyRequests(seconds: number, message: string) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return Response.json(
    { error: `${message} Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` },
    { status: 429, headers: { "retry-after": String(seconds), "cache-control": "private, no-store" } },
  );
}
