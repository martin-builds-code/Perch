export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}
export const DEFAULT_QUIET: QuietHours = {
  enabled: true,
  start: "00:00",
  end: "06:00",
};
const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function validQuiet(v: unknown): v is QuietHours {
  if (!v || typeof v !== "object") return false;
  const q = v as QuietHours;
  return (
    typeof q.enabled === "boolean" &&
    [q.start, q.end].every(
      (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s),
    ) &&
    q.start !== q.end
  );
}
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function sleeping(q: QuietHours, now = Date.now()) {
  if (!q.enabled) return false;
  const parts = formatter.formatToParts(now);
  const n =
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value);
  const a = minute(q.start),
    b = minute(q.end);
  return a < b ? n >= a && n < b : n >= a || n < b;
}
export function readQuiet() {
  try {
    const v = JSON.parse(localStorage.getItem("aero.quiet") ?? "null");
    return validQuiet(v) ? v : { ...DEFAULT_QUIET };
  } catch {
    return { ...DEFAULT_QUIET };
  }
}
