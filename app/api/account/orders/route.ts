import { listCustomerOrders, toSummary } from "../../../server/order-store";
import { customerFor, serverRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/** The signed-in customer's own orders, newest first. */
export async function GET(request: Request) {
  const runtime = serverRuntime();
  if (!runtime?.accounts) {
    return Response.json({ error: "Customer accounts are coming soon." }, { status: 404, headers: noStore });
  }
  const customer = await customerFor(runtime, request.headers);
  if (customer.state === "unavailable") {
    return Response.json({ error: "Your account could not be checked. Try again in a moment." }, { status: 503, headers: noStore });
  }
  if (customer.state === "signed_out") {
    return Response.json({ error: "Sign in to see your orders." }, { status: 401, headers: noStore });
  }
  try {
    const orders = await listCustomerOrders(runtime.db, customer.id);
    return Response.json(
      { customer: { name: customer.name, email: customer.email }, orders: orders.map(toSummary) },
      { headers: noStore },
    );
  } catch {
    console.error(JSON.stringify({ event: "order_history_failed" }));
    return Response.json({ error: "Your orders could not be loaded. Try again in a moment." }, { status: 503, headers: noStore });
  }
}
