// A local Breakthrough account issuer for the browser journey. It runs the
// same reviewed @royer/auth issuer as accounts-preview, over HTTPS on a
// *.localhost name, with an in-memory PostgreSQL and verification mail kept in
// memory. Synthetic accounts only; nothing here is deployed.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPrivateAuth } from "@royer/auth/server";
import { createIdentityIssuer } from "@royer/auth/issuer";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";

const run = promisify(execFile);

/** A throwaway CA and one certificate for the given *.localhost names. */
export async function localCertificates(hosts) {
  const directory = await mkdtemp(join(tmpdir(), "audiophile-local-tls-"));
  await writeFile(join(directory, "ca.conf"), [
    "[req]", "prompt=no", "distinguished_name=dn", "x509_extensions=ext",
    "[dn]", "CN=Audiophile synthetic test CA", "[ext]",
    "basicConstraints=critical,CA:TRUE", "keyUsage=critical,keyCertSign,cRLSign", "",
  ].join("\n"));
  await writeFile(join(directory, "server.conf"), [
    "[req]", "prompt=no", "distinguished_name=dn", "[dn]", `CN=${hosts[0]}`,
    "[ext]", "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth", `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(",")}`, "",
  ].join("\n"));
  const options = { cwd: directory, timeout: 15_000 };
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-config", "ca.conf", "-keyout", "ca.key", "-out", "ca.crt"], options);
  await run("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-config", "server.conf", "-keyout", "server.key", "-out", "server.csr"], options);
  await run("openssl", ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "1", "-sha256", "-extfile", "server.conf", "-extensions", "ext"], options);
  const [key, cert] = await Promise.all([readFile(join(directory, "server.key")), readFile(join(directory, "server.crt"))]);
  return { directory, caPath: join(directory, "ca.crt"), key, cert };
}

async function readBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Starts the issuer at `origin` (https://<name>.localhost:<port>) and registers `clients`. */
export async function startLocalIssuer({ origin, tls, clients }) {
  const database = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0 });
  await socket.start();
  const pool = new pg.Pool({ connectionString: `postgresql://postgres@${socket.getServerConn()}/postgres?sslmode=disable`, max: 1 });
  const mail = [];
  const config = {
    appId: "local-issuer",
    appName: "Breakthrough account (local test)",
    baseURL: origin,
    secret: randomBytes(32).toString("base64url"),
    database: pool,
    email: {
      sendVerification: async (message) => { mail.push({ kind: "verify", email: message.user.email, url: message.url }); },
      sendPasswordReset: async (message) => { mail.push({ kind: "reset", email: message.user.email, url: message.url }); },
    },
  };

  let auth = createPrivateAuth(config);
  await (await getMigrations(auth.engine.options)).runMigrations();
  const server = createServer(tls, async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      }
      const method = incoming.method ?? "GET";
      const body = ["GET", "HEAD"].includes(method) ? undefined : await readBody(incoming);
      const response = await auth.handler(new Request(new URL(incoming.url ?? "/", origin), { method, headers, body }));
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) if (key !== "set-cookie") outgoing.setHeader(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("set-cookie", cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "local_issuer_failed" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(origin).port), "::", resolve);
  });

  // In-process calls with a small cookie jar; no network or TLS involved.
  function session() {
    const cookies = new Map();
    const call = async (path, body) => {
      const headers = new Headers({ cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") });
      if (body !== undefined) {
        headers.set("content-type", "application/json");
        headers.set("origin", origin);
      }
      const response = await auth.handler(new Request(new URL(path, origin), {
        method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body),
      }));
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(";")[0];
        const at = pair.indexOf("=");
        if (pair.slice(at + 1)) cookies.set(pair.slice(0, at), pair.slice(at + 1));
        else cookies.delete(pair.slice(0, at));
      }
      return response;
    };
    call.cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    return call;
  }

  /** Signs up and verifies a synthetic account. Returns its issuer user ID. */
  async function createAccount({ name, email, password }) {
    const call = session();
    const created = await call("/api/auth/sign-up/email", { name, email, password });
    if (!created.ok) throw new Error(`Local sign-up failed with ${created.status}`);
    const { user } = await created.json();
    const verification = mail.findLast((message) => message.kind === "verify" && message.email === email);
    if (!verification) throw new Error("No verification mail was captured");
    const link = new URL(verification.url);
    const verified = await call(link.pathname + link.search);
    if (![200, 302].includes(verified.status)) throw new Error(`Verification failed with ${verified.status}`);
    return user.id;
  }

  // Bootstrap one operator, promote the issuer, then register each client the
  // way an operator does on accounts-preview's /operator page.
  const operator = { name: "Local operator", email: "operator@example.test", password: randomBytes(18).toString("base64url") };
  const operatorId = await createAccount(operator);
  auth = createIdentityIssuer({ ...config, operatorUserIds: [operatorId] });
  await (await getMigrations(auth.engine.options)).runMigrations();
  const operatorSession = session();
  const signedIn = await operatorSession("/api/auth/sign-in/email", { email: operator.email, password: operator.password });
  if (!signedIn.ok) throw new Error(`Operator sign-in failed with ${signedIn.status}`);
  const operatorHeaders = new Headers({ cookie: operatorSession.cookieHeader() });
  const credentials = [];
  for (const client of clients) credentials.push(await auth.registerClient({ operatorHeaders, ...client }));

  return {
    origin,
    issuerURL: `${origin}/api/auth`,
    credentials,
    createAccount,
    async close() {
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      await pool.end();
      await socket.stop();
      await database.close();
    },
  };
}
