import { newOrderSchema } from "../../order-api";
import { readJsonBody } from "../../payment-request";
import { createOrder, toSummary } from "../../server/order-store";
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
  const body = await readJsonBody(request, "order details");
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status, headers: noStore });
  const parsed = newOrderSchema.safeParse(body.payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Check the billing, shipping and payment details. Prices and totals are calculated by the store." },
      { status: 400, headers: noStore },
    );
  }

  const customer = await customerFor(runtime, request.headers);
  if (customer.state === "unavailable") {
    return Response.json(
      { error: "Your account could not be checked. Your order was not placed; try again in a moment." },
      { status: 503, headers: noStore },
    );
  }

  try {
    const result = await createOrder(runtime.db, parsed.data, customer.state === "signed_in" ? customer.id : null);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: noStore });
    return Response.json(
      { order: toSummary(result.order), replayed: result.replayed },
      { status: result.replayed ? 200 : 201, headers: noStore },
    );
  } catch {
    console.error(JSON.stringify({ event: "order_create_failed" }));
    return Response.json({ error: "Your order could not be saved. Nothing was charged; please try again." }, { status: 503, headers: noStore });
  }
}
