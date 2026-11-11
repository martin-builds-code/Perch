import { useEffect, useRef, useState } from "react";
import LiveApp from "./LiveApp";
import { DEFAULT_QUIET, readQuiet, sleeping, validQuiet } from "./quietHours";
import type { QuietHours } from "./quietHours";
export default function Appliance() {
  const [auth, setAuth] = useState<"checking" | "yes" | "no" | "offline">(
    "checking",
  );
  const [routeTrialUntil, setRouteTrialUntil] = useState<number | undefined>(
    undefined,
  );
  const [pin, setPin] = useState(""),
    [error, setError] = useState("");
  const [quiet, setQuiet] = useState<QuietHours>(readQuiet),
    [draft, setDraft] = useState<QuietHours>(quiet),
    [settings, setSettings] = useState(false),
    [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now),
    [generation, setGeneration] = useState(0),
    [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let stopped = false,
      busy = false,
      lastCheck = 0;
    let abort: AbortController | undefined;
    const check = async () => {
      setClock(Date.now());
      setVisible(document.visibilityState !== "hidden");
      if (
        stopped ||
        busy ||
        document.visibilityState === "hidden" ||
        (lastCheck > 0 && Date.now() - lastCheck < 3600000)
      )
        return;
      busy = true;
      abort = new AbortController();
      const timeout = setTimeout(() => abort?.abort(), 8000);
      try {
        const r = await fetch("/api/session", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!stopped) {
          setAuth(r.ok ? "yes" : r.status === 401 ? "no" : "offline");
          if (r.ok) {
            lastCheck = Date.now();
            const body = await r.json();
            const expires = body.routeDiagnosticTrial?.expiresAtMs;
            setRouteTrialUntil(
              typeof expires === "number" &&
                Number.isSafeInteger(expires) &&
                expires > Date.now()
                ? expires
                : undefined,
            );
          } else setRouteTrialUntil(undefined);
        }
      } catch {
        if (!stopped) setAuth((a) => (a === "yes" ? "yes" : "offline"));
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    const resume = () => {
      lastCheck = 0;
      void check();
    };
    const denied = () => setAuth("no");
    void check();
    const timer = setInterval(() => {
      setClock(Date.now());
      void check();
    }, 60000);
    const tick = setInterval(() => setClock(Date.now()), 1000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("aero-auth-required", denied);
    return () => {
      stopped = true;
      abort?.abort();
      clearInterval(timer);
      clearInterval(tick);
      clearTimeout(hold.current);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("aero-auth-required", denied);
    };
  }, []);
  useEffect(() => {
    if (routeTrialUntil === undefined) return;
    const timer = setTimeout(
      () => {
        setAuth("checking");
        setRouteTrialUntil(undefined);
        window.dispatchEvent(new Event("pageshow"));
      },
      Math.max(0, routeTrialUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [routeTrialUntil]);
  const asleep = sleeping(quiet, clock);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const b = await r.json();
      if (r.ok) {
        setPin("");
        setAuth("yes");
        setClock(Date.now());
        setGeneration((g) => g + 1);
      } else setError(b.error ?? "Sign-in failed");
    } catch {
      setError("Connection unavailable. Try again when online.");
    }
  }
  const open = () => {
    setDraft({ ...quiet });
    setSettings(true);
    setNotice("");
  };
  const cancelHold = () => clearTimeout(hold.current);
  const save = () => {
    if (!validQuiet(draft)) {
      setNotice(
        "Use different start and end times. Previous schedule retained.",
      );
      return;
    }
    try {
      localStorage.setItem("aero.quiet", JSON.stringify(draft));
      setQuiet({ ...draft });
      setSettings(false);
      setGeneration((g) => g + 1);
    } catch {
      setNotice("Device storage unavailable. Schedule was not saved.");
    }
  };
  if (auth !== "yes")
    return (
      <main className="access-screen">
        <form onSubmit={login}>
          <h1>
            {auth === "no"
              ? "Enter your PIN"
              : auth === "offline"
                ? "Connection unavailable"
                : "Connecting"}
          </h1>
          {auth === "no" ? (
            <>
              <label htmlFor="pin">Eight-digit PIN</label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{8}"
                minLength={8}
                maxLength={8}
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
              <button>Open display</button>
            </>
          ) : (
            <p>The display will reconnect automatically.</p>
          )}
          <p role="alert">{error}</p>
        </form>
      </main>
    );
  return (
    <>
      {routeTrialUntil ? (
        <div className="route-trial-banner">
          Experimental, temporarily unsecured Preview · expires{" "}
          {new Date(routeTrialUntil).toISOString()}
        </div>
      ) : null}
      {asleep ? (
        <main className="sleep-screen">
          <p>Sleeping until {quiet.end}</p>
          <small>Aircraft tracking paused</small>
        </main>
      ) : visible ? (
        <LiveApp
          key={String(generation) + ":" + String(routeTrialUntil)}
          routeTrialUntil={routeTrialUntil}
        />
      ) : (
        <main className="sleep-screen" />
      )}
      <button
        className="settings-corner"
        aria-label="Hold for settings"
        title="Hold for two seconds for quiet-hours settings"
        onPointerDown={() => {
          cancelHold();
          hold.current = setTimeout(open, 2000);
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onKeyDown={(e) => {
          if (e.key === "Enter") open();
        }}
      />
      {settings && (
        <div className="diagnostic-export-backdrop">
          <section
            className="diagnostic-export-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Quiet hours"
          >
            <h2>Quiet hours</h2>
            <p>Europe/London · adjusts for GMT/BST</p>
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />{" "}
              Enabled
            </label>
            <p>
              <label>
                Sleep{" "}
                <input
                  type="time"
                  value={draft.start}
                  onChange={(e) =>
                    setDraft({ ...draft, start: e.target.value })
                  }
                />
              </label>
            </p>
            <p>
              <label>
                Wake{" "}
                <input
                  type="time"
                  value={draft.end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </label>
            </p>
            <p role="alert">{notice}</p>
            <div className="quiet-actions">
              <button onClick={save}>Save</button>
              <button onClick={() => setDraft({ ...DEFAULT_QUIET })}>
                Restore defaults
              </button>
              <button onClick={() => setSettings(false)}>Close</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
