import { timingSafeEqual } from "node:crypto";
import { purgeAbandonedOrders } from "../../../server/order-store";
import { serverRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily Vercel Cron (vercel.json). Deletes orders never paid within seven
 * days, and rate-limit windows older than a day. Vercel sends CRON_SECRET as
 * a bearer token; without it, nothing runs.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Not allowed." }, { status: 401, headers: noStore });
  const runtime = serverRuntime();
  if (!runtime) return Response.json({ purgedOrders: 0, purgedRateLimitWindows: 0 }, { headers: noStore });
  try {
    const result = await purgeAbandonedOrders(runtime.db);
    console.log(JSON.stringify({ event: "abandoned_orders_purged", ...result }));
    return Response.json(result, { headers: noStore });
  } catch {
    console.error(JSON.stringify({ event: "abandoned_orders_purge_failed" }));
    return Response.json({ error: "The purge did not finish. It runs again tomorrow." }, { status: 503, headers: noStore });
  }
}
