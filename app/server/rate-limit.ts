import { createHmac, randomBytes } from "node:crypto";
import { isIPv6 } from "node:net";
import type pg from "pg";

/**
 * Fixed ten-minute windows in the database, so every serverless instance
 * shares the count. Addresses and session IDs are stored only as HMAC-SHA-256
 * buckets keyed by RATE_LIMIT_SECRET, so a copy of the table does not reveal
 * them, and windows older than a day are deleted by the daily purge.
 *
 * The address limit is the real one. The session limit only slows honest
 * browsers: a script can drop the cookie and get a new session each time.
 */
const WINDOW_SECONDS = 600;
export const limits = {
  ordersPerAddress: 10,
  ordersPerSession: 8,
  paymentStartsPerAddress: 30,
} as const;

export const SESSION_COOKIE = "audiophile_session";

/**
 * The client address Vercel's edge reports. IPv6 clients usually control a
 * whole /64, so they are counted per /64 rather than per address.
 */
export function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0].trim();
  if (!address) return "unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!isIPv6(address)) return address;
  return ipv6Prefix64(address);
}

function ipv6Prefix64(address: string) {
  const [head, tail = ""] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":") + "::/64";
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

// Without a configured secret (local runs), each process keys its own HMAC,
// which still never stores a reversible address.
const fallbackSecret = randomBytes(32).toString("hex");

let warned = false;

function bucket(scope: string, id: string) {
  const configured = process.env.RATE_LIMIT_SECRET?.trim();
  if (!configured && process.env.VERCEL_ENV && !warned) {
    warned = true;
    console.error(JSON.stringify({ event: "rate_limit_secret_missing", note: "limits are counted per instance" }));
  }
  const secret = configured || fallbackSecret;
  return createHmac("sha256", secret).update(`${scope}:${id}`).digest("hex");
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
