import { getOrder, toSummary } from "../../../server/order-store";
import { serverRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/** Order status by its receipt ID. No email, address or account details. */
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const runtime = serverRuntime();
  if (!runtime) return Response.json({ error: "Orders are kept in your browser only." }, { status: 404, headers: noStore });
  const { orderId } = await params;
  try {
    const order = await getOrder(runtime.db, orderId);
    if (!order) return Response.json({ error: "No order has that ID." }, { status: 404, headers: noStore });
    return Response.json({ order: toSummary(order) }, { headers: noStore });
  } catch {
    console.error(JSON.stringify({ event: "order_read_failed" }));
    return Response.json({ error: "The order could not be loaded. Try again in a moment." }, { status: 503, headers: noStore });
  }
}
