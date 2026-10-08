import { newOrderSchema } from "../../order-api";
import { readJsonBody } from "../../payment-request";
import { createOrder, toSummary } from "../../server/order-store";
import { browserSession, clientAddress, limits, newSessionCookie, overLimit, tooManyRequests } from "../../server/rate-limit";
import { customerFor, serverRuntime } from "../../server/runtime";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/**
 * Creates the order on the server before any payment starts. Totals come from
 * the catalog. A signed-in customer's order is saved to their account.
 */
export async function POST(request: Request) {
  const runtime = serverRuntime();
  if (!runtime) {
    return Response.json({ error: "This store keeps orders in your browser only." }, { status: 404, headers: noStore });
  }
  // Each browser gets an anonymous session cookie so both its address and the
  // session are limited, even when one of them changes.
  const session = browserSession(request);
  const sessionCookie = session ? null : newSessionCookie(request);
  const sessionId = session ?? sessionCookie!.slice(sessionCookie!.indexOf("=") + 1, sessionCookie!.indexOf(";"));
  const respond = (body: unknown, status: number) => {
    const response = Response.json(body, { status, headers: noStore });
    if (sessionCookie) response.headers.append("set-cookie", sessionCookie);
    return response;
  };
  try {
    const wait = await overLimit(runtime.db, [
      { scope: "orders:address", id: clientAddress(request), limit: limits.ordersPerAddress },
      { scope: "orders:session", id: sessionId, limit: limits.ordersPerSession },
    ]);
    if (wait !== null) {
      const limited = tooManyRequests(wait, "Too many orders from this browser or connection.");
      if (sessionCookie) limited.headers.append("set-cookie", sessionCookie);
      return limited;
    }
  } catch {
    console.error(JSON.stringify({ event: "rate_limit_failed" }));
    return respond({ error: "Your order could not be saved. Nothing was charged; please try again." }, 503);
  }

  const body = await readJsonBody(request, "order details");
  if (!body.ok) return respond({ error: body.error }, body.status);
  const parsed = newOrderSchema.safeParse(body.payload);
  if (!parsed.success && body.payload && typeof body.payload === "object" && "customer" in body.payload) {
    // A tab opened before the demo-store release still sends checkout details.
    return respond({ error: "This checkout page is out of date. Reload it and place the order again; nothing was charged." }, 400);
  }
  if (!parsed.success) {
    return respond({ error: "Check the billing, shipping and payment details. Prices and totals are calculated by the store." }, 400);
  }

  const customer = await customerFor(runtime, request.headers);
  if (customer.state === "unavailable") {
    return respond({ error: "Your account could not be checked. Your order was not placed; try again in a moment." }, 503);
  }

  try {
    const result = await createOrder(runtime.db, parsed.data, customer.state === "signed_in" ? customer.id : null);
    if (!result.ok) return respond({ error: result.error }, result.status);
    return respond({ order: toSummary(result.order), replayed: result.replayed }, result.replayed ? 200 : 201);
  } catch {
    console.error(JSON.stringify({ event: "order_create_failed" }));
    return respond({ error: "Your order could not be saved. Nothing was charged; please try again." }, 503);
  }
}
