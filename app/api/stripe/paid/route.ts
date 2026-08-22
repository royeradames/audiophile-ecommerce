import { listPaidOrders } from "../../../paid-ledger";
import { requestHostname } from "../../../request-origin";
import { staffAccessFromHost, staffCookieIsValid } from "../../../staff-session";

export async function GET(request: Request) {
  const hostname = requestHostname(request);
  const hasCookie = await staffCookieIsValid(request.headers.get("cookie"));
  const access = staffAccessFromHost(hostname, hasCookie);
  if (!access.ok) {
    return Response.json({ error: "Staff access required." }, { status: 401 });
  }
  return Response.json({ orders: listPaidOrders() });
}
