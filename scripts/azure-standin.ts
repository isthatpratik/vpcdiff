// A local stand-in for the Azure endpoints that the azurerm provider calls during `plan`
// (ADR 0011). It listens on 127.0.0.1 only, returns made-up metadata and an unsigned token
// for a made-up tenant, and answers every other request with 404. Nothing leaves the
// machine, and no real login is used.
//
// Usage: node scripts/azure-standin.ts <key.pem> <cert.pem> <port-file>
// It writes the port it listens on to <port-file>, then logs each request to stderr.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";

const [keyFile, certFile, portFile] = process.argv.slice(2);
if (!keyFile || !certFile || !portFile) {
  console.error("Usage: node scripts/azure-standin.ts <key.pem> <cert.pem> <port-file>");
  process.exit(2);
}

// Made-up identifiers (all zeros and ones), never a real tenant or subscription.
const STANDIN_TENANT = "00000000-0000-0000-0000-00000000000a";
const OBJECT = "00000000-0000-0000-0000-00000000000b";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
// An unsigned JWT: the provider reads its claims, and nothing verifies a signature here.
const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ aud: "standin", iss: "standin", tid: STANDIN_TENANT, oid: OBJECT, appid: OBJECT, exp: 4102444800, iat: 1767225600, nbf: 1767225600 })}.`;

const server = createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
  const host = `https://${req.headers.host ?? "127.0.0.1"}`;
  const url = req.url ?? "/";
  console.error(`[azure-standin] ${req.method} ${url.split("?")[0]}`);
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && url.startsWith("/metadata/endpoints")) {
    return json(200, {
      name: "VpcdiffStandIn",
      resourceManager: `${host}/`,
      authentication: { loginEndpoint: `${host}/`, audiences: [`${host}/`], tenant: "common", identityProvider: "AAD" },
      microsoftGraphResourceId: `${host}/`,
      suffixes: { storage: "standin.invalid", keyVaultDns: "vault.standin.invalid", sqlServerHostname: "database.standin.invalid" },
    });
  }
  if (req.method === "POST" && /\/oauth2\/(v2\.0\/)?token$/.test(url.split("?")[0] ?? "")) {
    req.resume();
    return json(200, { token_type: "Bearer", expires_in: 3600, ext_expires_in: 3600, access_token: token });
  }
  return json(404, { error: { code: "NotFound", message: "vpcdiff stand-in: this endpoint is not provided" } });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") writeFileSync(portFile, String(address.port));
});
