import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import session from "../api/session";
import aircraft from "../api/aircraft";
import enrichment from "../api/enrichment";
import { derivePin, signSession, authConfig } from "../server/auth";
test("HTTP authentication: private endpoints, login, CSRF, renewal, cookie privacy, bad PIN and throttling", async () => {
  const keys = [
    "AERO_SESSION_SECRET",
    "AERO_PIN_PEPPER",
    "AERO_PIN_VERIFIER",
    "AERO_LIVE_ENABLED",
    "AERO_ENRICHMENT_ENABLED",
  ];
  const saved = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    AERO_SESSION_SECRET: "s".repeat(64),
    AERO_PIN_PEPPER: "p".repeat(64),
    AERO_PIN_VERIFIER: derivePin("00123456", "p".repeat(64)),
    AERO_LIVE_ENABLED: "true",
    AERO_ENRICHMENT_ENABLED: "true",
  });
  const server = createServer((req, res) => {
    void (
      req.url === "/api/session"
        ? session
        : req.url?.startsWith("/api/enrichment")
          ? enrichment
          : aircraft
    )(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  const base = "http://127.0.0.1:" + address.port;
  try {
    for (const path of [
      "/api/session",
      "/api/aircraft",
      "/api/enrichment?kind=aircraft&hex=abcdef",
    ]) {
      const r = await fetch(base + path);
      assert.equal(r.status, 401);
      assert.doesNotMatch(await r.text(), /latitude|secret|verifier|pepper/);
    }
    const headers = { "Content-Type": "application/json", Origin: base };
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.invalid" },
          body: '{"pin":"00123456"}',
        })
      ).status,
      403,
    );
    const r = await fetch(base + "/api/session", {
      method: "POST",
      headers,
      body: '{"pin":"00123456"}',
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
    assert.doesNotMatch(await r.text(), /00123456|pepper|secret/);
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      200,
    );
    const old = signSession(authConfig(), Date.now() - 2 * 86400000);
    assert.ok(
      (
        await fetch(base + "/api/session", {
          headers: { Cookie: "__Host-aero=" + old },
        })
      ).headers.get("set-cookie"),
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await fetch(base + "/api/session", {
            method: "POST",
            headers,
            body: '{"pin":"00000000"}',
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers,
          body: '{"pin":"00123456"}',
        })
      ).status,
      429,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});
