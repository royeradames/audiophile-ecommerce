import { listPaidOrders as listRememberedPaidOrders } from "../../../paid-ledger";
import { requestHostname } from "../../../request-origin";
import { listPaidOrders } from "../../../server/order-store";
import { serverRuntime } from "../../../server/runtime";
import { staffAccessFromHost, staffCookieIsValid } from "../../../staff-session";

export async function GET(request: Request) {
  const hostname = requestHostname(request);
  const hasCookie = await staffCookieIsValid(request.headers.get("cookie"));
  const access = staffAccessFromHost(hostname, hasCookie);
  if (!access.ok) {
    return Response.json({ error: "Staff access required." }, { status: 401 });
  }
  const runtime = serverRuntime();
  if (!runtime) {
    // Guest-only fallback: payments recorded since this server started.
    return Response.json({ orders: listRememberedPaidOrders() });
  }
  try {
    return Response.json({ orders: await listPaidOrders(runtime.db) }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Paid orders could not be loaded. Try again in a moment." }, { status: 503 });
  }
}
