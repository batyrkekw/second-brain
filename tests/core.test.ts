import { describe, it, expect } from "vitest";
import {
  bounded,
  callback,
  fts,
  page,
  tags,
  title,
  validateUpdate,
} from "../src/utils/input";
import { dayBounds, parseDate, timezone } from "../src/utils/dates";
describe("input", () => {
  it("generates titles without changing original content", () => {
    expect(title("  First line\nsecond")).toBe("First line");
    expect(title("x".repeat(100))).toHaveLength(80);
  });
  it("bounds input, pages and callback data", () => {
    expect(() => bounded("")).toThrow();
    expect(() => bounded("a".repeat(4001))).toThrow();
    expect(page("2")).toBe(2);
    expect(() => page("-1")).toThrow();
    expect(() => page("1.2")).toThrow();
    expect(() => callback("note:1;DROP")).toThrow();
  });
  it("normalizes tags and rejects excessive tags", () => {
    expect(tags("#Work,work, Learning")).toEqual(["work", "learning"]);
    expect(() => tags("x".repeat(33))).toThrow();
  });
  it("escapes FTS operators", () =>
    expect(fts("a OR b")).toBe('"a" AND "OR" AND "b"'));
  it("rejects malformed Telegram input", () => {
    expect(
      validateUpdate({ update_id: 1, message: { from: { id: "2" } } }),
    ).toBeNull();
    expect(validateUpdate({ update_id: -1 })).toBeNull();
    expect(validateUpdate({ update_id: 1 })).toEqual({ update_id: 1 });
  });
});
describe("dates", () => {
  const now = Date.parse("2026-10-17T08:00:00Z");
  it("uses elapsed minutes and user-local calendar dates", () => {
    expect(parseDate("in 10 minutes", "UTC", now)).toBe(now + 600000);
    expect(parseDate("tomorrow at 18:00", "Asia/Almaty", now)).toBe(
      Date.parse("2026-10-18T13:00:00Z"),
    );
    expect(parseDate("on 2026-10-20 at 09:00", "UTC", now)).toBe(
      Date.parse("2026-10-20T09:00Z"),
    );
    expect(parseDate("in 3 days", "UTC", now)).toBe(now + 3 * 86400000);
  });
  it("rejects invalid, expired, arbitrary, and ambiguous dates", () => {
    for (const t of [
      "yesterday",
      "in 0 minutes",
      "on 2026-02-30 at 12:00",
      "on 2026-10-17 at 01:00",
    ])
      expect(() => parseDate(t, "UTC", now)).toThrow();
    expect(() =>
      parseDate("on 2026-11-01 at 01:30", "America/New_York", now),
    ).toThrow();
    expect(() => timezone("Mars/Base")).toThrow();
  });
  it("handles DST day boundaries", () => {
    const [a, b] = dayBounds(
      Date.parse("2026-03-08T12:00Z"),
      "America/New_York",
    );
    expect(b - a).toBe(23 * 3600000);
  });
});
