import { Store } from "../db";
import type { Note, Reply } from "../types";
import {
  bounded,
  categories,
  fts,
  InputError,
  page,
  tags,
  title,
} from "../utils/input";
import { display } from "../utils/dates";
import { button as b, pager, reply } from "../telegram/ui";
export async function createNote(s: Store, text: string): Promise<Reply> {
  bounded(text);
  await s.limit("notes");
  const id = crypto.randomUUID();
  s.write(
    "INSERT INTO notes(id,user_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    id,
    s.uid,
    title(text),
    text,
    s.now,
    s.now,
  );
  return reply(
    `Saved to your Second Brain 🧠\n\nTitle: ${title(text)}\nCategory: Inbox`,
    [
      [b("Add tags", `tags:${id}`), b("Create task", `ntask:${id}`)],
      [b("Set reminder", `nrem:${id}`), b("View note", `note:${id}`)],
    ],
  );
}
export async function getNote(s: Store, id: string): Promise<Note> {
  const n = await s.one<Note>(
    "SELECT * FROM notes WHERE id=? AND user_id=?",
    id,
    s.uid,
  );
  if (!n) throw new InputError("Note not found. Open /notes.");
  return n;
}
export async function viewNote(
  s: Store,
  id: string,
  zone: string,
): Promise<Reply> {
  const n = await getNote(s, id);
  const ts = await s.all<{ name: string }>(
    "SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.note_id=? AND nt.user_id=?",
    id,
    s.uid,
  );
  return reply(
    `${n.pinned ? "📌 " : ""}${n.title}\n${n.category}${n.archived ? " · Archived" : ""}\n${ts.map((t) => "#" + t.name).join(" ")}\n\n${n.content}\n\nUpdated ${display(n.updated_at, zone)}`,
    [
      [
        b("Edit", `edit:${id}`),
        b("Tags", `tags:${id}`),
        b("Category", `category:${id}`),
      ],
      [
        b(n.archived ? "Restore" : "Archive", `archive:${id}`),
        b(n.pinned ? "Unpin" : "Pin", `pin:${id}`),
      ],
      [b("Create task", `ntask:${id}`), b("Remind me", `nrem:${id}`)],
      [b("Delete", `delnote:${id}`), b("My notes", "notes:0")],
    ],
  );
}
export async function listNotes(
  s: Store,
  pValue: string | undefined,
  query = "",
): Promise<Reply> {
  const p = page(pValue),
    args: unknown[] = [s.uid];
  const where = ["n.user_id=?"];
  const take = (re: RegExp): string | undefined => {
    const m = re.exec(query);
    if (m) {
      query = query.replace(m[0], " ").trim();
      return m[1];
    }
    return undefined;
  };
  const archive = take(/\barchived:(true|false)\b/i);
  where.push("n.archived=?");
  args.push(archive?.toLowerCase() === "true" ? 1 : 0);
  const pin = take(/\bpinned:(true|false)\b/i);
  if (pin) {
    where.push("n.pinned=?");
    args.push(pin.toLowerCase() === "true" ? 1 : 0);
  }
  const cat = take(/\bcategory:(\w+)\b/i);
  if (cat) {
    where.push("lower(n.category)=lower(?)");
    args.push(cat);
  }
  const tag = take(/\btag:"([^"\n]+)"/i) ?? take(/#([\p{L}\p{N}_-]+)/u);
  if (tag) {
    where.push(
      "EXISTS(SELECT 1 FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND nt.user_id=n.user_id AND t.name=?)",
    );
    args.push(tag.toLowerCase());
  }
  const sort = take(/\bsort:(oldest|updated|recent)\b/i)?.toLowerCase();
  if (query.trim()) {
    where.push(
      "n.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)",
    );
    const q = query.trim();
    args.push(
      q.startsWith('"') && q.endsWith('"')
        ? '"' + q.slice(1, -1).replaceAll('"', '""') + '"'
        : fts(q),
    );
  }
  const order =
    sort === "oldest"
      ? "n.created_at ASC"
      : sort === "updated"
        ? "n.updated_at DESC"
        : "n.created_at DESC";
  const rows = await s.all<Note>(
    `SELECT n.* FROM notes n WHERE ${where.join(" AND ")} ORDER BY n.pinned DESC,${order},n.id LIMIT 9 OFFSET ?`,
    ...args,
    p * 8,
  );
  return reply(
    rows.length
      ? `Your notes · page ${p + 1}${query ? `\nSearch: ${query}` : ""}`
      : "No matching notes. Send an idea, link, or information you want to remember.",
    [
      ...rows
        .slice(0, 8)
        .map((n) => [b(`${n.pinned ? "📌 " : ""}${n.title}`, `note:${n.id}`)]),
      pager("notes", p, rows.length > 8),
      [b("Search / filters", "search"), b("Archive", "archived:0")],
      [b("Add note", "add"), b("⌂ Menu", "home")],
    ].filter((r) => r.length),
  );
}
export async function setTags(
  s: Store,
  id: string,
  text: string,
): Promise<Reply> {
  await getNote(s, id);
  const names = text.trim() === "-" ? [] : tags(text);
  s.write("DELETE FROM note_tags WHERE note_id=? AND user_id=?", id, s.uid);
  for (const name of names) {
    s.write(
      "INSERT INTO tags(user_id,name) VALUES(?,?) ON CONFLICT(user_id,name) DO NOTHING",
      s.uid,
      name,
    );
    s.write(
      "INSERT INTO note_tags(note_id,tag_id,user_id) SELECT ?,id,? FROM tags WHERE user_id=? AND name=?",
      id,
      s.uid,
      s.uid,
      name,
    );
  }
  s.write(
    "UPDATE notes SET updated_at=? WHERE id=? AND user_id=?",
    s.now,
    id,
    s.uid,
  );
  return reply("Tags updated.", [[b("View note", `note:${id}`)]]);
}
export function categoryButtons(id: string): Reply {
  return reply(
    "Choose a category.",
    categories.map((c, i) => [b(c, `cat:${id}:${i}`)]),
  );
}
