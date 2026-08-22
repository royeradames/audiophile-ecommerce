const COOKIE_NAME = "audiophile_staff";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function staffPassword() {
  const password = process.env.STAFF_PASSWORD?.trim() ?? "";
  return password || null;
}

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export type StaffAccess =
  | { ok: true; mode: "password" | "dev-open" }
  | { ok: false; mode: "login" | "unconfigured" };

export function staffAccessFromHost(hostname: string, hasCookie: boolean): StaffAccess {
  const password = staffPassword();
  if (password) {
    return hasCookie ? { ok: true, mode: "password" } : { ok: false, mode: "login" };
  }
  if (isLocalHost(hostname)) {
    return { ok: true, mode: "dev-open" };
  }
  return { ok: false, mode: "unconfigured" };
}

export async function createStaffCookie(now = Date.now()) {
  const password = staffPassword();
  if (!password) {
    return null;
  }
  const payload = String(now);
  const signature = await hmacHex(password, payload);
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
}

export async function staffCookieIsValid(cookieHeader: string | null, now = Date.now()) {
  const password = staffPassword();
  if (!password || !cookieHeader) {
    return false;
  }
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) {
    return false;
  }
  const value = match.slice(`${COOKIE_NAME}=`.length);
  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return false;
  }
  const expected = await hmacHex(password, payload);
  if (!timingEqual(signature, expected)) {
    return false;
  }
  const created = Number(payload);
  if (!Number.isFinite(created) || now - created > MAX_AGE_MS) {
    return false;
  }
  return true;
}

export async function passwordMatches(candidate: string) {
  const password = staffPassword();
  if (!password) {
    return false;
  }
  return timingEqual(candidate, password);
}
