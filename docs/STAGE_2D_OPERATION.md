# Stage 2D - implementation, administration and physical acceptance

Baseline: 9156a9892ffd4b06485ffd58ee003b9c15d244c7. Development branch:
`stage-2d-unattended-operation`. No merge or Production release is authorised.

## Implementation report

The optional build flag `VITE_AERO_APPLIANCE_ENABLED=true` adds remembered-device
PIN entry and a quiet-hours supervisor around the accepted live display. Simulation
remains unchanged. All live APIs enforce authentication independently of this UI
flag. The session endpoint is the only public application endpoint (still behind
Vercel protection in Preview). Diagnostics remain browser-local; no diagnostic
upload/export endpoint or database exists. Authentication loss unmounts the live
view and cancels its requests. The accepted poller/selector/enricher algorithms,
provider budgets, movement policy and freshness thresholds are preserved.

PIN credentials: exactly eight ASCII digits, including leading zeros; HMAC-SHA256
with a random server pepper followed by salted scrypt N=16384/r=8/p=1. Only a derived
verifier, pepper and independent signing secret are configured server-side.
Sessions are signed HMAC tokens in __Host-aero, Secure, HttpOnly, SameSite=Strict,
Path=/, no Domain; rolling 90-day expiry, renewed after a day on authorised requests.
The browser rechecks at startup, restoration/visibility/network events and hourly
while executing; failed initial checks retry each minute. A 401 from either live
API returns directly to sign-in. PIN/verifier/pepper rotation changes the credential
version and revokes earlier signatures on deployments using the new configuration.

**Security boundary:** login failures are limited to five per 15 minutes per
reported client address per warm process, with bounded hashed-address memory.
This is not shared or distributed rate limiting. Cold starts, multiple instances,
and changing addresses can bypass the counter. Eight digits are low entropy;
peppering protects an offline verifier, not online guessing. Vercel protection
must remain enabled on Preview. Internet-facing Production suitability must be
explicitly reviewed before release; no claim of robust global brute-force defence
is made. This personal appliance is not an account system or security-sensitive
application. No paid limiter, tracking database or identity provider was added.

Private API responses now use private/no-store and CDN no-store. This deliberate
security change prevents CDN cached aircraft from bypassing cookie validation.
The server's 10-second cache, 15-second gate and timestamp-preserving gap bridge
remain. Cross-instance caching/gates remain independent. Cache-hit rates may fall;
Hobby headroom and aggregate traffic still need observation. Session checks add
bounded same-origin function calls; quiet hours stop aircraft/enrichment calls,
not occasional authentication validation.

Quiet preferences are non-sensitive device-local JSON, default 00:00-06:00 enabled,
Europe/London. Intl time-zone parts handle GMT/BST. End is exclusive; crossing
midnight is supported; equal or malformed times are rejected without replacing the
last valid saved schedule. Storage errors are reported instead of claiming a save.
A small supervisor reconciles each second while executing and on restoration.
Sleeping unmounts tracking: cleanup aborts browser requests, stops both managers,
discards queued work/selection and clears the display. Already-started server or
provider work may finish. Wake creates a fresh live view, not yesterday's aircraft.
Settings: hold the upper-right 48px corner for two seconds; keyboard users can
focus it and press Enter. Close leaves saved preferences unchanged; Restore defaults
loads the default draft, then Save commits it. No permanent navigation bar.

Diagnostics retain the accepted schema and controls. Export before closing,
authentication loss, background unmount or a quiet-hours transition: the collector
is memory-only and a fresh tracking instance starts after those transitions.
No provider requests are added by diagnostics. Quiet hours are a browser scheduling
policy, not a server-side ban on requests from other authorised clients.

## Administrator setup guide

1. Keep Production untouched. Use only this Vercel project's Preview settings.
2. The initial review Preview receives randomly generated credentials through Work.
   Its PIN is handed over privately, never in source or this guide.
3. To choose/change a PIN, use the repository's `scripts/configure-auth.mjs` on a
   trusted administrator computer with Node installed (not the Mac mini collector).
   Run `umask 077`, then `read -r -s AERO_SETUP_PIN`, type eight digits and press
   Enter. Run `printf '%s' "$AERO_SETUP_PIN" | node scripts/configure-auth.mjs > auth-private.json`,
   then `unset AERO_SETUP_PIN`. The output file is secret: do not commit/upload it.
   Alternatively ask Work to prepare a new private setup under separate authority.
4. In Vercel Settings > Environment Variables, add the three output values as
   sensitive Preview-only variables: AERO_PIN_VERIFIER, AERO_PIN_PEPPER,
   AERO_SESSION_SECRET. Never use a VITE_ prefix for them. Keep the existing eight
   live/enrichment/diagnostic settings; add VITE_AERO_APPLIANCE_ENABLED=true.
5. Configuration changes require a separately authorised replacement deployment.
   Changing PIN/verifier, pepper or signing secret invalidates sessions on that
   replacement; all three generated values can be replaced together. Signing-secret
   rotation alone also revokes sessions. Existing immutable deployments retain old
   configuration: restrict/revoke their share access and retire old links as part of
   an authorised rotation. There is no instantaneous cross-deployment revocation.
6. Open the protected Preview Shareable Link, then enter the separate application
   PIN. Vercel access and application authentication are independent layers.
7. Eventual permanent URL: https://perch-aero-pane.vercel.app (existing alias).
   Do not activate it here. A separately approved Production build must enable
   VITE_AERO_APPLIANCE_ENABLED, live and enrichment flags, use distinct Production
   auth secrets/private location, and explicitly set AERO_PRODUCTION_LIVE_ENABLED=true.
   Without that server flag Production live APIs remain disabled. Production must
   rely on application cookies/PIN, not assume temporary Vercel sharing applies.
   Reassess the bounded login protection before public exposure. Do not connect Git.

## iPad operating guide

Open the private review link in landscape, enter the eight-digit PIN once. Leading
zeros matter. Keep Safari visible, the iPad powered and online. Safari cookies can
be cleared/evicted by the OS or browsing settings; 90 days is a target, not a promise.
Do not use Private Browsing for the trial. Home Screen mode may have a separate
cookie/storage context: sign in and save the schedule there if using it.

Hold the upper-right corner for two seconds to edit quiet hours. If Guided Access
blocks touch there, end Guided Access temporarily, change the schedule, then enable
it again. No hidden PIN-change screen exists. At night the display becomes near
black with the configured wake time. It resumes with fresh tracking while Safari
is executing. No tap or refresh is needed for ordinary recovery.

A webpage cannot wake a suspended iPad or reopen itself after restart. Set iPad
Auto-Lock to Never if available, or use Guided Access as appropriate; verify on the
actual Air 2. The sleeping view does not switch off the backlight or control system
brightness. After closing Safari or restarting the device, reopen the saved link.
Do not reload/close before exporting diagnostics. The client reconciles missed
schedule boundaries on return; no guarantee of a timer firing during suspension.

## Verification and 72-hour trial

Run npm run lint, npm test, npm run build; repeat the build with the live,
enrichment, diagnostic and appliance VITE_ flags enabled. New tests cover PIN format,
signing/rotation/expiry, cookie attributes, direct API rejection, session renewal,
CSRF and process-local throttling; schedule tests cover custom/disabled/overnight,
equal-time rejection and both London DST changes. Existing tests retain provider,
selection, parsing, timeout, cache/gate and diagnostic coverage. Authentication
fixtures now attach genuine signed test cookies; no runtime authentication bypass.

Physical acceptance remains separate: verify landscape/card readability, long
route labels, login keypad, corner hold, Home Screen cookie retention, Files export,
Guided Access and responsiveness on iPad Air 2 / 15.8.5. Desktop Chromium and Safari
15 build targeting are not physical Safari certification. No material Air 2 visual
compromise is intended; report any demonstrated failure before accepting one.

After review, arrange a separately authorised 72-hour household trial with an access
link lasting the full period. A temporary 23-hour Shareable Link alone cannot
establish permanent access or an uninterrupted 72-hour trial. Start during daytime,
keep powered/visible, observe two overnight sleeps/wakes, briefly turn iPad Wi-Fi
off/on once in daytime (do not alter Mac mini/router), and note any required manual
intervention. Check remembered access after an ordinary reload. Do not keep a
browser diagnostic trial recording for 72 hours: it remains bounded to 30-60 minutes.
No persistent telemetry is added. Final acceptance requires user review and the
physical trial; this implementation is not automatically Stage 2D acceptance.
