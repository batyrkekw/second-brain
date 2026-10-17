import { Temporal } from "@js-temporal/polyfill";
import { InputError } from "./input";
export function timezone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    if (!zone.includes("/") && zone !== "UTC") throw Error();
    return zone;
  } catch {
    throw new InputError(
      "Enter an IANA timezone, for example Asia/Almaty, Europe/London, or UTC.",
    );
  }
}
export function display(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}
export function dayBounds(now: number, zone: string): [number, number] {
  const z = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .startOfDay();
  return [z.epochMilliseconds, z.add({ days: 1 }).epochMilliseconds];
}
export function weekStart(now: number, zone: string): number {
  const z = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .startOfDay();
  return z.subtract({ days: z.dayOfWeek - 1 }).epochMilliseconds;
}
export function parseDate(
  text: string,
  zone: string,
  now = Date.now(),
): number {
  timezone(zone);
  const s = text.trim().toLowerCase();
  const rel = /^in (\d{1,4}) (minute|hour|day)s?$/.exec(s);
  let result: number;
  if (rel) {
    const n = Number(rel[1]);
    if (n < 1) throw new InputError("Choose a future date.");
    const z =
      Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone);
    result = z.add(
      rel[2] === "day"
        ? { days: n }
        : rel[2] === "hour"
          ? { hours: n }
          : { minutes: n },
    ).epochMilliseconds;
  } else {
    const m = /^(tomorrow|(?:on )?\d{4}-\d{2}-\d{2}) at (\d{2}):(\d{2})$/.exec(
      s,
    );
    if (!m)
      throw new InputError(
        "Use “in 10 minutes”, “in 2 hours”, “in 3 days”, “tomorrow at 18:00”, or “on YYYY-MM-DD at HH:MM”.",
      );
    try {
      const date =
        m[1] === "tomorrow"
          ? Temporal.Instant.fromEpochMilliseconds(now)
              .toZonedDateTimeISO(zone)
              .add({ days: 1 })
              .toPlainDate()
              .toString()
          : m[1]!.replace("on ", "");
      result = Temporal.ZonedDateTime.from(`${date}T${m[2]}:${m[3]}[${zone}]`, {
        disambiguation: "reject",
        overflow: "reject",
      }).epochMilliseconds;
    } catch {
      throw new InputError(
        "That time is invalid or ambiguous (possibly a daylight-saving transition). Choose another time.",
      );
    }
  }
  if (result <= now || result > now + 366 * 5 * 86400000)
    throw new InputError("Choose a future date within five years.");
  return result;
}
