import type { Update } from "../types";
export class InputError extends Error {}
export const categories = [
  "Inbox",
  "Ideas",
  "Learning",
  "Projects",
  "Personal",
  "Work",
  "Resources",
  "Other",
];
export function bounded(text: string, max = 4000): string {
  if (!text.trim() || text.length > max)
    throw new InputError(`Please enter 1–${max} characters.`);
  return text;
}
export function title(text: string): string {
  return text.trim().split("\n")[0]!.slice(0, 80);
}
export function tags(text: string): string[] {
  const list = [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (
    list.length > 10 ||
    list.some((t) => t.length > 32 || !/^[\p{L}\p{N}_ -]+$/u.test(t))
  )
    throw new InputError(
      "Use up to 10 comma-separated tags, each 1–32 letters, numbers, spaces, _ or -.",
    );
  return list;
}
export function page(value: string | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 1000)
    throw new InputError("Invalid page.");
  return n;
}
export function validateUpdate(value: unknown): Update | null {
  if (typeof value !== "object" || !value) return null;
  const u = value as Record<string, unknown>;
  if (!Number.isSafeInteger(u.update_id) || Number(u.update_id) < 0)
    return null;
  const id = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) > 0;
  if (u.message) {
    const m = u.message as Update["message"];
    if (
      !m ||
      !id(m.from?.id) ||
      !id(m.chat?.id) ||
      typeof m.chat?.type !== "string" ||
      (m.text !== undefined && typeof m.text !== "string")
    )
      return null;
  }
  if (u.callback_query) {
    const c = u.callback_query as Update["callback_query"];
    if (
      !c ||
      typeof c.id !== "string" ||
      c.id.length > 128 ||
      !id(c.from?.id) ||
      (c.data !== undefined &&
        (typeof c.data !== "string" || c.data.length > 64)) ||
      !c.message ||
      !id(c.message.chat?.id) ||
      typeof c.message.chat?.type !== "string"
    )
      return null;
  }
  return u as unknown as Update;
}
export function callback(data: string): string[] {
  if (!/^[a-z0-9:_-]{1,64}$/i.test(data))
    throw new InputError("That button is invalid. Open /start again.");
  return data.split(":");
}
export function fts(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => '"' + t.replaceAll('"', '""') + '"')
    .join(" AND ");
}
