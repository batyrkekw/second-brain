import { exportData } from "./services/export";
import { Store } from "./db";
import type { Reply } from "./types";
import {
  bounded,
  callback,
  categories,
  InputError,
  tags,
  title,
} from "./utils/input";
import { display, parseDate, timezone, weekStart } from "./utils/dates";
import { button as b, help, home, reply } from "./telegram/ui";
import {
  categoryButtons,
  createNote,
  getNote,
  listNotes,
  setTags,
  viewNote,
} from "./services/notes";
import {
  createTask,
  listReminders,
  listTasks,
  listVocab,
  stats,
  task,
  viewTask,
} from "./services/productivity";
function prompt(s: Store, state: string, text: string): Reply {
  s.state(state);
  return reply(text + "\n\n/cancel to go back.");
}
export async function handle(
  s: Store,
  text: string | undefined,
  data: string | undefined,
): Promise<Reply> {
  const settings = await s.settings();
  const z = settings.timezone;
  if (data) {
    const [action, id, arg] = callback(data);
    s.state(null);
    switch (action) {
      case "home":
        return reply("Your Second Brain 🧠", home);
      case "help":
        return reply(help, home);
      case "add":
        return prompt(
          s,
          "note",
          "Send your note. I will preserve your original text.",
        );
      case "search":
        return prompt(
          s,
          "search",
          "Search words, an exact phrase in double quotes, #tag, category:Learning, archived:true, pinned:true, sort:oldest, or sort:updated. Combine filters.",
        );
      case "notes": {
        const search = await s.one<{ query: string }>(
          "SELECT query FROM search_state WHERE user_id=? AND kind=?",
          s.uid,
          "notes",
        );
        return listNotes(s, id, search?.query ?? "");
      }
      case "archived":
        s.write(
          "INSERT INTO search_state(user_id,kind,query) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET query=excluded.query",
          s.uid,
          "notes",
          "archived:true",
        );
        return listNotes(s, id, "archived:true");
      case "note":
        return viewNote(s, id!, z);
      case "edit":
        await getNote(s, id!);
        return prompt(s, `edit:${id}`, "Send the replacement note content.");
      case "tags":
        await getNote(s, id!);
        return prompt(
          s,
          `tags:${id}`,
          "Send comma-separated tags (up to 10). Send - to clear tags.",
        );
      case "category":
        await getNote(s, id!);
        return categoryButtons(id!);
      case "cat":
        await getNote(s, id!);
        if (!categories[Number(arg)] || !/^\d$/.test(arg ?? ""))
          throw new InputError("Invalid category.");
        s.write(
          "UPDATE notes SET category=?,updated_at=? WHERE id=? AND user_id=?",
          categories[Number(arg)],
          s.now,
          id,
          s.uid,
        );
        return reply("Category updated.", [[b("View note", `note:${id}`)]]);
      case "archive":
      case "pin": {
        await getNote(s, id!);
        const col = action === "pin" ? "pinned" : "archived";
        s.write(
          `UPDATE notes SET ${col}=1-${col},updated_at=? WHERE id=? AND user_id=?`,
          s.now,
          id,
          s.uid,
        );
        return reply("Note updated.", [[b("View note", `note:${id}`)]]);
      }
      case "delnote":
        await getNote(s, id!);
        return reply(
          "Permanently delete this note? Linked tasks and reminders will keep their text.",
          [[b("Delete permanently", `yesnote:${id}`), b("Keep", `note:${id}`)]],
        );
      case "yesnote":
        await getNote(s, id!);
        s.write("DELETE FROM notes WHERE id=? AND user_id=?", id, s.uid);
        return reply("Note deleted.");
      case "ntask": {
        const n = await getNote(s, id!);
        return createTask(s, n.title, id);
      }
      case "nrem": {
        const n = await getNote(s, id!);
        return prompt(
          s,
          `remdate:${id}`,
          "When should I remind you about " +
            n.title +
            "?\nExample: tomorrow at 18:00. Timezone: " +
            z,
        );
      }
      case "tasks":
        return listTasks(s, id!, arg, z);
      case "addtask":
        return prompt(
          s,
          "task",
          "Send a task title, then optionally a description on the following lines.",
        );
      case "task":
        return viewTask(s, id!, z);
      case "toggle": {
        const t = await task(s, id!);
        s.write(
          "UPDATE tasks SET status=?,completed_at=?,updated_at=? WHERE id=? AND user_id=?",
          t.status === "pending" ? "completed" : "pending",
          t.status === "pending" ? s.now : null,
          s.now,
          id,
          s.uid,
        );
        return reply("Task updated.", [[b("View task", `task:${id}`)]]);
      }
      case "edittask":
        await task(s, id!);
        return prompt(
          s,
          `edittask:${id}`,
          "Send a title and optional description on following lines.",
        );
      case "due":
        await task(s, id!);
        return prompt(
          s,
          `due:${id}`,
          "Enter a due time, for example tomorrow at 18:00, or - to clear. Timezone: " +
            z,
        );
      case "priority":
        await task(s, id!);
        return reply(
          "Choose priority.",
          ["low", "normal", "high"].map((p) => [b(p, `prio:${id}:${p}`)]),
        );
      case "prio":
        await task(s, id!);
        if (!["low", "normal", "high"].includes(arg ?? ""))
          throw new InputError("Invalid priority.");
        s.write(
          "UPDATE tasks SET priority=?,updated_at=? WHERE id=? AND user_id=?",
          arg,
          s.now,
          id,
          s.uid,
        );
        return reply("Priority updated.", [[b("View task", `task:${id}`)]]);
      case "deltask":
        await task(s, id!);
        return reply("Delete task?", [
          [b("Delete", `yestask:${id}`), b("Keep", `task:${id}`)],
        ]);
      case "yestask":
        await task(s, id!);
        s.write("DELETE FROM tasks WHERE id=? AND user_id=?", id, s.uid);
        return reply("Task deleted.");
      case "addrem":
        return prompt(
          s,
          "reminder",
          "Send a time and message separated by |\nExample: in 10 minutes | Study Python\nTimezone: " +
            z,
        );
      case "reminders":
        return listReminders(s, id, z);
      case "reminder": {
        const r = await s.one<{
          content: string;
          due_at: number;
          status: string;
        }>("SELECT * FROM reminders WHERE id=? AND user_id=?", id, s.uid);
        if (!r) throw new InputError("Reminder not found.");
        return reply(
          `${r.content}\n${display(r.due_at, z)} (${z})\nStatus: ${r.status}`,
          [
            [b("Cancel", `cancelrem:${id}`), b("Dismiss", `dismiss:${id}`)],
            [b("Delete", `delrem:${id}`), b("Reminders", "reminders:0")],
          ],
        );
      }
      case "confirmrem": {
        const draft = await s.one<{
          id: string;
          content: string;
          due_at: number;
          note_id: string | null;
          expires: number;
        }>("SELECT * FROM reminder_drafts WHERE user_id=? AND id=?", s.uid, id);
        if (!draft || draft.expires < s.now || draft.due_at <= s.now)
          throw new InputError(
            "That confirmation expired. Create a new reminder.",
          );
        await s.limit("reminders");
        s.write(
          "INSERT INTO reminders(id,user_id,content,note_id,due_at,next_attempt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          draft.id,
          s.uid,
          draft.content,
          draft.note_id,
          draft.due_at,
          draft.due_at,
          s.now,
          s.now,
        );
        s.write("DELETE FROM reminder_drafts WHERE user_id=?", s.uid);
        return reply("Reminder saved.", [[b("Reminders", "reminders:0")]]);
      }
      case "cancelrem":
      case "dismiss":
      case "delrem": {
        const r = await s.one(
          "SELECT id FROM reminders WHERE id=? AND user_id=?",
          id,
          s.uid,
        );
        if (!r) throw new InputError("Reminder not found.");
        if (action === "delrem")
          s.write("DELETE FROM reminders WHERE id=? AND user_id=?", id, s.uid);
        else
          s.write(
            "UPDATE reminders SET status=?,updated_at=? WHERE id=? AND user_id=?",
            action === "dismiss" ? "dismissed" : "cancelled",
            s.now,
            id,
            s.uid,
          );
        return reply(
          "Reminder updated. A notification already in flight may still arrive.",
        );
      }
      case "vocab": {
        const search = await s.one<{ query: string }>(
          "SELECT query FROM search_state WHERE user_id=? AND kind=?",
          s.uid,
          "vocab",
        );
        return listVocab(s, id, search?.query ?? "");
      }
      case "addvocab":
        return prompt(
          s,
          "vocab",
          "Send word | definition | example | translation | comma-separated tags\nOnly the word is required. No definitions are invented.",
        );
      case "searchvocab":
        return prompt(s, "searchvocab", "Enter a vocabulary search.");
      case "delvocab":
        s.write("DELETE FROM vocabulary WHERE id=? AND user_id=?", id, s.uid);
        return reply("Word deleted, if it existed.");
      case "settings":
        return reply(
          `Settings\nTimezone: ${z}\nLanguage: ${settings.language} (interface: English)\nReminders: ${settings.reminders_enabled ? "on" : "off"}\nTelegram ID: ${s.uid}`,
          [
            [b("Timezone", "timezone"), b("Language", "language")],
            [b("Toggle reminders", "rempref"), b("Export data", "export")],
            [b("Delete account data", "deleteaccount"), b("⌂ Menu", "home")],
          ],
        );
      case "timezone":
        return prompt(
          s,
          "timezone",
          "Enter an IANA timezone, such as Asia/Almaty, Europe/London, or UTC.",
        );
      case "language":
        return reply(
          "English is fully translated. Russian preference is saved for a future translation.",
          [[b("English", "lang:en"), b("Russian (English UI)", "lang:ru")]],
        );
      case "lang":
        if (!["en", "ru"].includes(id ?? ""))
          throw new InputError("Invalid language.");
        s.write(
          "UPDATE user_settings SET language=? WHERE user_id=?",
          id,
          s.uid,
        );
        return reply("Language preference saved.");
      case "rempref":
        s.write(
          "UPDATE user_settings SET reminders_enabled=1-reminders_enabled WHERE user_id=?",
          s.uid,
        );
        return reply(
          "Reminder preference toggled. Paused reminders are retained and may arrive when enabled again.",
        );
      case "deleteaccount":
        return prompt(
          s,
          "deleteaccount",
          "Permanently remove all your data? Type DELETE MY DATA to confirm.",
        );
      case "export": {
        const doc = await exportData(s, settings);
        return { text: "Your export", document: doc };
      }
      default:
        throw new InputError(
          "That button is no longer available. Open /start.",
        );
    }
  }
  if (!text)
    return reply(
      "Send text to save a note. Attachments are not stored in this release.",
      home,
    );
  if (text.startsWith("/")) {
    const [raw, ...rest] = text.trim().split(/\s+/);
    const command = raw!.split("@")[0]!.toLowerCase();
    const arg = rest.join(" ");
    s.state(null);
    switch (command) {
      case "/start": {
        const exists = await s.one("SELECT id FROM users WHERE id=?", s.uid);
        return reply(
          exists
            ? "Welcome back to Second Brain 🧠\nSend anything worth remembering."
            : "Welcome to Second Brain 🧠\n\nYour personal space for ideas, knowledge, tasks, and reminders.\n\nSend me anything worth remembering. I’ll keep it organized so you can find it later.\n\nDates use UTC until you choose a timezone in Settings.",
          home,
        );
      }
      case "/help":
        return reply(help, home);
      case "/cancel":
        return reply("Input cancelled.", home);
      case "/notes":
        s.write(
          "DELETE FROM search_state WHERE user_id=? AND kind=?",
          s.uid,
          "notes",
        );
        return listNotes(s, "0");
      case "/search":
        return arg
          ? search(s, "notes", arg)
          : prompt(s, "search", "Enter search words or filters.");
      case "/tasks":
        return listTasks(s, "pending", "0", z);
      case "/today":
        return listTasks(s, "today", "0", z);
      case "/overdue":
        return listTasks(s, "overdue", "0", z);
      case "/reminders":
      case "/cancel_reminder":
        return listReminders(s, "0", z);
      case "/vocab":
        s.write(
          "DELETE FROM search_state WHERE user_id=? AND kind=?",
          s.uid,
          "vocab",
        );
        return listVocab(s, "0");
      case "/stats":
        return stats(s, weekStart(s.now, z));
      case "/settings":
        return handle(s, undefined, "settings");
      default:
        return reply(
          "Unknown command. Use /help, or send ordinary text to save a note.",
        );
    }
  }
  const state =
    settings.state_expires && settings.state_expires > s.now
      ? settings.state
      : null;
  if (state) {
    const [kind, id] = state.split(":");
    bounded(text);
    s.state(null);
    switch (kind) {
      case "note":
        return createNote(s, text);
      case "search":
        return search(s, "notes", text);
      case "searchvocab":
        return search(s, "vocab", text);
      case "edit":
        await getNote(s, id!);
        s.write(
          "UPDATE notes SET content=?,title=?,updated_at=? WHERE id=? AND user_id=?",
          text,
          title(text),
          s.now,
          id,
          s.uid,
        );
        return reply("Note updated.", [[b("View note", `note:${id}`)]]);
      case "tags":
        return setTags(s, id!, text);
      case "task":
        return createTask(s, text);
      case "edittask": {
        await task(s, id!);
        bounded(text, 1000);
        const [name, ...desc] = text.split("\n");
        s.write(
          "UPDATE tasks SET title=?,description=?,updated_at=? WHERE id=? AND user_id=?",
          bounded(name!, 200),
          desc.join("\n"),
          s.now,
          id,
          s.uid,
        );
        return reply("Task updated.", [[b("View task", `task:${id}`)]]);
      }
      case "due":
        await task(s, id!);
        s.write(
          "UPDATE tasks SET due_at=?,updated_at=? WHERE id=? AND user_id=?",
          text === "-" ? null : parseDate(text, z, s.now),
          s.now,
          id,
          s.uid,
        );
        return reply("Due date updated.", [[b("View task", `task:${id}`)]]);
      case "timezone":
        s.write(
          "UPDATE user_settings SET timezone=? WHERE user_id=?",
          timezone(text.trim()),
          s.uid,
        );
        return reply(
          "Timezone saved. Existing reminders keep their scheduled instant.",
        );
      case "reminder": {
        const parts = text.split("|");
        if (parts.length !== 2)
          throw new InputError(
            "Use time | message. Example: in 10 minutes | Study Python",
          );
        return draftReminder(s, parts[0]!, parts[1]!.trim(), z, null);
      }
      case "remdate": {
        const n = await getNote(s, id!);
        return draftReminder(s, text, n.title, z, id!);
      }
      case "vocab": {
        await s.limit("vocabulary");
        const parts = text.split("|").map((t) => t.trim());
        if (parts.length > 5)
          throw new InputError("Use up to five fields separated by |.");
        const [word, def = "", example = "", translation = "", tagText = ""] =
          parts;
        bounded(word!, 100);
        bounded(text, 2000);
        const tagNames = tags(tagText);
        const vid = crypto.randomUUID();
        s.write(
          "INSERT INTO vocabulary(id,user_id,word,definition,example,translation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          vid,
          s.uid,
          word,
          def,
          example,
          translation,
          s.now,
          s.now,
        );
        for (const name of tagNames) {
          s.write(
            "INSERT INTO tags(user_id,name) VALUES(?,?) ON CONFLICT(user_id,name) DO NOTHING",
            s.uid,
            name,
          );
          s.write(
            "INSERT INTO vocabulary_tags(vocabulary_id,tag_id) SELECT ?,id FROM tags WHERE user_id=? AND name=?",
            vid,
            s.uid,
            name,
          );
        }
        return reply("Word saved.", [[b("Vocabulary", "vocab:0")]]);
      }
      case "deleteaccount":
        if (text !== "DELETE MY DATA")
          throw new InputError(
            "Confirmation did not match. Use /cancel to keep your data.",
          );
        s.write(
          "UPDATE webhook_events SET reply='{}',delivered=1 WHERE user_id=?",
          s.uid,
        );
        s.write("DELETE FROM users WHERE id=?", s.uid);
        return reply(
          "Your stored data has been deleted. Telegram retains messages in your chat; you can clear the chat in Telegram. Send /start to begin again.",
        );
    }
  }
  const natural = /^remind me (.+?) to ([\s\S]+)$/i.exec(text);
  if (natural) return draftReminder(s, natural[1]!, natural[2]!, z, null);
  return createNote(s, text);
}
async function search(
  s: Store,
  kind: "notes" | "vocab",
  query: string,
): Promise<Reply> {
  bounded(query, 200);
  s.write(
    "INSERT INTO search_state(user_id,kind,query) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET query=excluded.query",
    s.uid,
    kind,
    query,
  );
  return kind === "notes" ? listNotes(s, "0", query) : listVocab(s, "0", query);
}
async function draftReminder(
  s: Store,
  time: string,
  content: string,
  z: string,
  note: string | null,
): Promise<Reply> {
  bounded(content, 1000);
  const due = parseDate(time, z, s.now);
  const id = crypto.randomUUID();
  s.write(
    "INSERT INTO reminder_drafts(user_id,id,content,due_at,note_id,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,content=excluded.content,due_at=excluded.due_at,note_id=excluded.note_id,expires=excluded.expires",
    s.uid,
    id,
    content,
    due,
    note,
    s.now + 900000,
  );
  return reply(
    `Remind you: ${content}\n\n${display(due, z)} (${z})\nConfirm this time.`,
    [[b("Confirm", `confirmrem:${id}`), b("Cancel", "home")]],
  );
}
