import { serverRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
const callbackPath = "/api/auth/federation/callback";
const noStore = { "cache-control": "private, no-store" };

/**
 * The browser lands on the callback by navigation, so a failed or expired
 * sign-in must show a page, not the handler's JSON. Send it back to the
 * account page with a reason, keeping any cookies the handler cleared.
 */
function callbackFailure(response: Response | null, origin: string) {
  const reason = !response || response.status === 503 ? "unavailable" : response.status === 409 ? "linking" : "expired";
  const headers = new Headers({ location: new URL(`/account?error=${reason}`, origin).href, ...noStore });
  for (const cookie of response?.headers.getSetCookie() ?? []) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

async function handle(request: Request) {
  const accounts = serverRuntime()?.accounts;
  if (!accounts) {
    return Response.json({ error: "Customer accounts are coming soon." }, { status: 404, headers: noStore });
  }
  const url = new URL(request.url);
  const callback = request.method === "GET" && url.pathname === callbackPath;
  try {
    const response = await accounts.handler(request);
    return callback && response.status >= 400 ? callbackFailure(response, url.origin) : response;
  } catch {
    if (callback) return callbackFailure(null, url.origin);
    return Response.json({ error: "Account access is temporarily unavailable. Please try again." }, { status: 503, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
