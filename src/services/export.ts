import { Store } from "../db";
import { InputError } from "../utils/input";
import type { Settings } from "../types";
export async function exportData(
  s: Store,
  settings: Settings,
): Promise<string> {
  const out: Record<string, unknown> = {
    user_id: s.uid,
    settings: {
      timezone: settings.timezone,
      language: settings.language,
      reminders_enabled: settings.reminders_enabled,
    },
  };
  const cap = 900000;
  let bytes = 0;
  let queries = 0;
  for (const table of [
    "notes",
    "tags",
    "note_tags",
    "tasks",
    "reminders",
    "vocabulary",
    "vocabulary_tags",
  ] as const) {
    const items: unknown[] = [];
    out[table] = items;
    for (let offset = 0; ; offset += 100) {
      // Bound both memory and query budget, including sparse tag associations.
      if (++queries > 25)
        throw new InputError(
          "Export is too large for the bot. Ask the operator for a database export.",
        );
      const rows =
        table === "vocabulary_tags"
          ? await s.all(
              "SELECT vt.* FROM vocabulary_tags vt JOIN vocabulary v ON v.id=vt.vocabulary_id WHERE v.user_id=? ORDER BY vt.vocabulary_id,vt.tag_id LIMIT 100 OFFSET ?",
              s.uid,
              offset,
            )
          : await s.all(
              `SELECT * FROM ${table} WHERE user_id=? ORDER BY rowid LIMIT 100 OFFSET ?`,
              s.uid,
              offset,
            );
      bytes += new TextEncoder().encode(JSON.stringify(rows)).length;
      if (bytes > cap)
        throw new InputError(
          "Export exceeds the bot’s 1 MB limit. Ask the operator for a database export.",
        );
      items.push(...rows);
      if (rows.length < 100) break;
    }
  }
  return JSON.stringify(out);
}
