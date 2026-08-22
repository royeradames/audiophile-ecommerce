import { passwordMatches, staffAccessFromHost, staffCookieIsValid, createStaffCookie } from "../../../staff-session";
import { requestHostname } from "../../../request-origin";

export async function GET(request: Request) {
  const hostname = requestHostname(request);
  const hasCookie = await staffCookieIsValid(request.headers.get("cookie"));
  return Response.json(staffAccessFromHost(hostname, hasCookie));
}

export async function POST(request: Request) {
  const payload = (await request.json()) as { password?: string };
  const password = payload.password ?? "";
  if (!(await passwordMatches(password))) {
    return Response.json({ error: "That staff password does not match." }, { status: 401 });
  }
  const cookie = await createStaffCookie();
  if (!cookie) {
    return Response.json({ error: "STAFF_PASSWORD is not set." }, { status: 503 });
  }
  return new Response(JSON.stringify({ ok: true, mode: "password" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": cookie,
    },
  });
}
