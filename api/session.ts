import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authorised,
  authConfig,
  checkPin,
  signSession,
  sessionCookie,
  sameOrigin,
  clientKey,
  loginGate,
  failedLogin,
} from "../server/auth.js";
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET") {
    if (authorised(req, res)) res.end('{"authenticated":true}');
    return;
  }
  if (
    req.method !== "POST" ||
    !sameOrigin(req) ||
    req.headers["content-type"]?.split(";")[0] !== "application/json"
  ) {
    res.statusCode = 403;
    res.end('{"error":"invalid-request"}');
    return;
  }
  const key = clientKey(req),
    delay = loginGate(key);
  if (delay) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(delay));
    res.end('{"error":"Too many attempts. Try again in 15 minutes."}');
    return;
  }
  try {
    const config = authConfig();
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 256) throw Error("body");
    }
    const value = JSON.parse(body);
    if (!checkPin(value.pin, config)) {
      failedLogin(key);
      res.statusCode = 401;
      res.end('{"error":"Incorrect PIN. Enter exactly eight digits."}');
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(signSession(config)));
    res.end('{"authenticated":true}');
  } catch {
    res.statusCode = 503;
    res.end('{"error":"Sign-in unavailable. Please try again later."}');
  }
}
