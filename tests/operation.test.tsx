import test from "node:test";
import assert from "node:assert/strict";
import {
  authConfig,
  derivePin,
  checkPin,
  signSession,
  validSession,
  SESSION_SECONDS,
  loginGate,
  failedLogin,
  sessionCookie,
} from "../server/auth";
import { DEFAULT_QUIET, sleeping, validQuiet } from "../src/quietHours";
const pepper = "p".repeat(64),
  secret = "s".repeat(64),
  verifier = derivePin("00123456", pepper);
const env = {
  AERO_PIN_PEPPER: pepper,
  AERO_SESSION_SECRET: secret,
  AERO_PIN_VERIFIER: verifier,
};
const c = authConfig(env);
for (const pin of [
  "00123456",
  "99999999",
  "1234567",
  "123456789",
  "abcdefgh",
  "１２３４５６７８",
])
  test("PIN verification " + pin, () =>
    assert.equal(checkPin(pin, c), pin === "00123456"),
  );
test("configuration fail closed", () => assert.throws(() => authConfig({})));
test("signed session remembers device and rejects tampering", () => {
  const t = signSession(c, 1000);
  assert.ok(validSession(t, c, 2000));
  assert.equal(validSession(t + "x", c, 2000), false);
});
test("90-day expiry and future issue rejected", () => {
  const t = signSession(c, 1000);
  assert.equal(validSession(t, c, 999), false);
  assert.equal(validSession(t, c, 1000 + SESSION_SECONDS * 1000), false);
});
test("PIN, pepper and signing rotation revoke old sessions", () => {
  const t = signSession(c);
  for (const e of [
    { ...env, AERO_SESSION_SECRET: "x".repeat(64) },
    { ...env, AERO_PIN_VERIFIER: derivePin("99999999", pepper) },
    { ...env, AERO_PIN_PEPPER: "z".repeat(64) },
  ])
    assert.equal(validSession(t, authConfig(e)), false);
});
test("cookie is secure HttpOnly and SameSite", () =>
  assert.match(
    sessionCookie("test"),
    /HttpOnly; Secure; SameSite=Strict; Max-Age=7776000/,
  ));
test("process-local attempt protection expires", () => {
  for (let i = 0; i < 5; i++) failedLogin("fixture", 1000);
  assert.ok(loginGate("fixture", 1001));
  assert.equal(loginGate("fixture", 901001), 0);
});
for (const [time, result] of [
  ["2026-11-03T00:00:00Z", true],
  ["2026-11-03T05:59:59Z", true],
  ["2026-11-03T06:00:00Z", false],
  ["2026-03-29T00:59:00Z", true],
  ["2026-03-29T01:00:00Z", true],
  ["2026-03-29T05:00:00Z", false],
  ["2026-10-25T00:59:00Z", true],
  ["2026-10-25T01:00:00Z", true],
  ["2026-10-25T06:00:00Z", false],
] as const)
  test("London schedule " + time, () =>
    assert.equal(sleeping(DEFAULT_QUIET, Date.parse(time)), result),
  );
test("overnight and daytime custom schedules", () => {
  assert.ok(
    sleeping(
      { enabled: true, start: "22:00", end: "07:00" },
      Date.parse("2026-11-03T23:00Z"),
    ),
  );
  assert.ok(
    sleeping(
      { enabled: true, start: "10:00", end: "11:00" },
      Date.parse("2026-11-03T10:30Z"),
    ),
  );
  assert.equal(sleeping({ ...DEFAULT_QUIET, enabled: false }), false);
});
for (const q of [
  { enabled: true, start: "00:00", end: "00:00" },
  { enabled: true, start: "24:00", end: "06:00" },
  { enabled: true, start: "1:00", end: "06:00" },
])
  test("invalid schedule " + JSON.stringify(q), () =>
    assert.equal(validQuiet(q), false),
  );
