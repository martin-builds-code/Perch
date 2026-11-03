import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
export const SESSION_SECONDS = 90 * 86400;
const NAME = "__Host-aero";
export function authConfig(env = process.env) {
  const {
    AERO_SESSION_SECRET: secret,
    AERO_PIN_PEPPER: pepper,
    AERO_PIN_VERIFIER: verifier,
  } = env;
  if (
    !secret ||
    secret.length < 64 ||
    !pepper ||
    pepper.length < 64 ||
    !verifier ||
    !/^s1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(verifier)
  )
    throw Error("auth-configuration");
  return {
    secret,
    pepper,
    verifier,
    version: createHash("sha256")
      .update(verifier + pepper)
      .digest("hex"),
  };
}
export function derivePin(
  pin: string,
  pepper: string,
  salt = randomBytes(16).toString("hex"),
) {
  if (!/^\d{8}$/.test(pin)) throw Error("Eight digits required");
  return (
    "s1:" +
    salt +
    ":" +
    scryptSync(createHmac("sha256", pepper).update(pin).digest(), salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    }).toString("hex")
  );
}
export function checkPin(pin: unknown, c = authConfig()) {
  if (typeof pin !== "string" || !/^\d{8}$/.test(pin)) return false;
  return timingSafeEqual(
    Buffer.from(derivePin(pin, c.pepper, c.verifier.split(":")[1])),
    Buffer.from(c.verifier),
  );
}
export function signSession(c = authConfig(), now = Date.now()) {
  const data = Buffer.from(
    JSON.stringify({
      v: c.version,
      iat: now,
      exp: now + SESSION_SECONDS * 1000,
    }),
  ).toString("base64url");
  return (
    data + "." + createHmac("sha256", c.secret).update(data).digest("base64url")
  );
}
export function validSession(
  token: string,
  c = authConfig(),
  now = Date.now(),
) {
  try {
    if (token.length > 1024) return false;
    const [data, sig, ...extra] = token.split(".");
    if (extra.length || !data || !sig) return false;
    const expected = createHmac("sha256", c.secret).update(data).digest();
    const got = Buffer.from(sig, "base64url");
    if (got.length !== expected.length || !timingSafeEqual(got, expected))
      return false;
    const p = JSON.parse(Buffer.from(data, "base64url").toString());
    return (
      p.v === c.version &&
      Number.isFinite(p.iat) &&
      p.iat <= now &&
      p.exp === p.iat + SESSION_SECONDS * 1000 &&
      p.exp > now
    );
  } catch {
    return false;
  }
}
export function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  return `${NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function authorised(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  try {
    const c = authConfig();
    const token =
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(NAME + "="))
        ?.slice(NAME.length + 1) ?? "";
    if (validSession(token, c)) {
      // Renew only after a day; avoids competing cookies on every poll.
      const p = JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString(),
      );
      if (Date.now() - p.iat >= 86400000)
        res.setHeader("Set-Cookie", sessionCookie(signSession(c)));
      return true;
    }
  } catch {
    /* Fail closed without revealing configuration. */
  }
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end('{"error":"authentication-required"}');
  return false;
}
export function sameOrigin(req: IncomingMessage) {
  try {
    return new URL(req.headers.origin ?? "").host === req.headers.host;
  } catch {
    return false;
  }
}
const failures = new Map<string, { count: number; until: number }>();
export function loginGate(key: string, now = Date.now()) {
  for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
  const v = failures.get(key);
  return v && v.count >= 5 ? Math.max(1, Math.ceil((v.until - now) / 1000)) : 0;
}
export function failedLogin(key: string, now = Date.now()) {
  if (failures.size >= 256) failures.delete(failures.keys().next().value!);
  const v = failures.get(key);
  failures.set(key, {
    count: (v?.count ?? 0) + 1,
    until: v?.until ?? now + 15 * 60000,
  });
}
export function clientKey(req: IncomingMessage) {
  return createHash("sha256")
    .update(
      String(
        req.headers["x-forwarded-for"] ??
          req.socket?.remoteAddress ??
          "unknown",
      ).slice(0, 200),
    )
    .digest("hex");
}
