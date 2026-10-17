import { Store } from "../db";
import type { Reply, Task } from "../types";
import { bounded, InputError, page } from "../utils/input";
import { dayBounds, display } from "../utils/dates";
import { button as b, pager, reply } from "../telegram/ui";
export async function task(s: Store, id: string): Promise<Task> {
  const t = await s.one<Task>(
    "SELECT * FROM tasks WHERE id=? AND user_id=?",
    id,
    s.uid,
  );
  if (!t) throw new InputError("Task not found. Open /tasks.");
  return t;
}
export async function createTask(
  s: Store,
  text: string,
  noteId: string | null = null,
): Promise<Reply> {
  bounded(text, 1000);
  await s.limit("tasks");
  const [name, ...desc] = text.split("\n");
  const id = crypto.randomUUID();
  s.write(
    "INSERT INTO tasks(id,user_id,title,description,note_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    id,
    s.uid,
    bounded(name!, 200),
    desc.join("\n"),
    noteId,
    s.now,
    s.now,
  );
  return reply("Task created.", [[b("View task", `task:${id}`)]]);
}
export async function viewTask(
  s: Store,
  id: string,
  zone: string,
): Promise<Reply> {
  const t = await task(s, id);
  return reply(
    `${t.status === "completed" ? "✅" : "☐"} ${t.title}\n${t.description}\nPriority: ${t.priority}\nDue: ${t.due_at ? display(t.due_at, zone) : "Not set"}`,
    [
      [
        b(t.status === "completed" ? "Reopen" : "Complete", `toggle:${id}`),
        b("Edit", `edittask:${id}`),
      ],
      [b("Set due date", `due:${id}`), b("Priority", `priority:${id}`)],
      [b("Delete", `deltask:${id}`), b("Tasks", "tasks:pending:0")],
    ],
  );
}
export async function listTasks(
  s: Store,
  filter: string,
  pv: string | undefined,
  zone: string,
): Promise<Reply> {
  const p = page(pv);
  const [start, end] = dayBounds(s.now, zone);
  const filters: Record<string, [string, number[]]> = {
    pending: ["status='pending'", []],
    completed: ["status='completed'", []],
    today: ["status='pending' AND due_at>=? AND due_at<?", [start, end]],
    overdue: ["status='pending' AND due_at<?", [s.now]],
    upcoming: ["status='pending' AND due_at>=?", [end]],
  };
  const f = filters[filter];
  if (!f) throw new InputError("Invalid task filter.");
  const rows = await s.all<Task>(
    `SELECT * FROM tasks WHERE user_id=? AND ${f[0]} ORDER BY due_at IS NULL,due_at,created_at DESC,id LIMIT 9 OFFSET ?`,
    s.uid,
    ...f[1],
    p * 8,
  );
  return reply(
    `Tasks · ${filter} · page ${p + 1}${rows.length ? "" : "\nNo tasks here yet."}`,
    [
      ...rows.slice(0, 8).map((t) => [b(t.title, `task:${t.id}`)]),
      pager(`tasks:${filter}`, p, rows.length > 8),
      [b("Pending", "tasks:pending:0"), b("Completed", "tasks:completed:0")],
      [
        b("Today", "tasks:today:0"),
        b("Overdue", "tasks:overdue:0"),
        b("Upcoming", "tasks:upcoming:0"),
      ],
      [b("Add task", "addtask"), b("⌂ Menu", "home")],
    ].filter((r) => r.length),
  );
}
export async function listReminders(
  s: Store,
  pv: string | undefined,
  zone: string,
): Promise<Reply> {
  const p = page(pv);
  const rows = await s.all<{
    id: string;
    content: string;
    due_at: number;
    status: string;
  }>(
    "SELECT * FROM reminders WHERE user_id=? ORDER BY due_at DESC,id LIMIT 9 OFFSET ?",
    s.uid,
    p * 8,
  );
  return reply(
    `Reminders · page ${p + 1}${rows.length ? "" : "\nNo reminders yet. Choose Add reminder."}`,
    [
      ...rows
        .slice(0, 8)
        .map((r) => [
          b(
            `${r.status} · ${display(r.due_at, zone)} · ${r.content.slice(0, 35)}`,
            `reminder:${r.id}`,
          ),
        ]),
      pager("reminders", p, rows.length > 8),
      [b("Add reminder", "addrem"), b("⌂ Menu", "home")],
    ].filter((r) => r.length),
  );
}
export async function listVocab(
  s: Store,
  pv: string | undefined,
  query = "",
): Promise<Reply> {
  const p = page(pv);
  const rows = await s.all<{
    id: string;
    word: string;
    definition: string;
    example: string;
    translation: string;
  }>(
    "SELECT * FROM vocabulary WHERE user_id=? AND (instr(lower(word),lower(?))>0 OR instr(lower(definition),lower(?))>0) ORDER BY created_at DESC,id LIMIT 9 OFFSET ?",
    s.uid,
    query,
    query,
    p * 8,
  );
  return reply(
    rows.length
      ? rows
          .slice(0, 8)
          .map(
            (v) => `${v.word}\n${v.definition}\n${v.example}\n${v.translation}`,
          )
          .join("\n\n")
      : "No words found. Save a word with any information you already know.",
    [
      ...rows
        .slice(0, 8)
        .map((v) => [b(`Delete ${v.word.slice(0, 30)}`, `delvocab:${v.id}`)]),
      pager("vocab", p, rows.length > 8),
      [b("Add word", "addvocab"), b("Search words", "searchvocab")],
      [b("⌂ Menu", "home")],
    ].filter((r) => r.length),
  );
}
export async function stats(s: Store, week: number): Promise<Reply> {
  const n = await s.one<{ total: number; week: number }>(
    "SELECT count(*) total,sum(created_at>=?) week FROM notes WHERE user_id=?",
    week,
    s.uid,
  );
  const t = await s.one<{ active: number; done: number }>(
    "SELECT sum(status='pending') active,sum(status='completed') done FROM tasks WHERE user_id=?",
    s.uid,
  );
  const r = await s.one<{ n: number }>(
    "SELECT count(*) n FROM reminders WHERE user_id=? AND status IN ('pending','sending')",
    s.uid,
  );
  const tags = await s.all<{ name: string; n: number }>(
    "SELECT t.name,count(*) n FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.user_id=? GROUP BY t.id ORDER BY n DESC,t.name LIMIT 5",
    s.uid,
  );
  return reply(
    `Your Second Brain\n\nNotes: ${n?.total ?? 0}\nCreated this week: ${n?.week ?? 0}\nActive tasks: ${t?.active ?? 0}\nCompleted tasks: ${t?.done ?? 0}\nUpcoming reminders: ${r?.n ?? 0}\nTop tags: ${tags.map((t) => `${t.name} (${t.n})`).join(", ") || "None yet"}`,
  );
}
