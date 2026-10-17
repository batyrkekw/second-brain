import { beforeEach, describe, it, expect, vi } from "vitest";
import { database } from "./db";
import worker, { webhook } from "../src/index";
import { Telegram, TelegramError } from "../src/telegram/api";
import { processReminders } from "../src/services/reminders";
import type { Env, Reply } from "../src/types";
let env: Env;
let api: Telegram;
let replies: Reply[];
let sequence = 1;
beforeEach(() => {
  env = {
    DB: database(),
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
  };
  api = new Telegram("test");
  replies = [];
  vi.spyOn(api, "reply").mockImplementation(async (_chat, r) => {
    replies.push(r);
  });
  vi.spyOn(api, "answer").mockResolvedValue();
  sequence = 1;
});
async function send(
  text?: string,
  data?: string,
  user = 1,
  update = sequence++,
): Promise<Response> {
  return webhook(
    new Request("https://test/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
      body: JSON.stringify({
        update_id: update,
        ...(data
          ? {
              callback_query: {
                id: "cb",
                from: { id: user },
                data,
                message: { chat: { id: user, type: "private" } },
              },
            }
          : {
              message: {
                message_id: update,
                from: { id: user },
                chat: { id: user, type: "private" },
                text,
              },
            }),
      }),
    }),
    env,
    api,
  );
}
async function one<T>(sql: string, ...args: unknown[]): Promise<T> {
  return (await env.DB.prepare(sql)
    .bind(...args)
    .first<T>()) as T;
}
const last = () => replies[replies.length - 1]!;
describe("webhook and notes", () => {
  it("authenticates, validates JSON, and exposes minimal health", async () => {
    expect(
      (await worker.fetch(new Request("https://test/health"), env)).status,
    ).toBe(200);
    expect(
      (
        await webhook(
          new Request("https://test/webhook", { method: "POST", body: "{}" }),
          env,
          api,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await webhook(
          new Request("https://test/webhook", {
            method: "POST",
            headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
            body: "{",
          }),
          env,
          api,
        )
      ).status,
    ).toBe(400);
  });
  it("onboards without resetting and creates, searches, edits, archives, restores and deletes", async () => {
    await send("/start");
    expect(last().text).toContain("Welcome to");
    await send("/start");
    expect(last().text).toContain("Welcome back");
    await send("PostgreSQL indexes\nKeep Original.");
    const n = await one<{ id: string }>("SELECT id FROM notes");
    await send(undefined, `note:${n.id}`);
    expect(last().text).toContain("Keep Original.");
    await send(undefined, `tags:${n.id}`);
    await send("database,learning");
    await send(undefined, `cat:${n.id}:2`);
    await send("/search #database category:Learning");
    expect(
      last()
        .buttons?.flat()
        .some((b) => b.callback_data === `note:${n.id}`),
    ).toBe(true);
    await send('/search "PostgreSQL indexes"');
    expect(last().text).toContain("Your notes");
    await send(undefined, `edit:${n.id}`);
    await send("Revised indexing");
    expect(
      (await one<{ content: string }>("SELECT content FROM notes")).content,
    ).toBe("Revised indexing");
    await send(undefined, `archive:${n.id}`);
    expect(
      (await one<{ archived: number }>("SELECT archived FROM notes")).archived,
    ).toBe(1);
    await send(undefined, `archive:${n.id}`);
    await send(undefined, `pin:${n.id}`);
    await send(undefined, `delnote:${n.id}`);
    expect(last().text).toContain("Permanently delete");
    await send(undefined, `yesnote:${n.id}`);
    expect((await one<{ n: number }>("SELECT count(*) n FROM notes")).n).toBe(
      0,
    );
    expect(
      (await one<{ n: number }>("SELECT count(*) n FROM note_tags")).n,
    ).toBe(0);
  });
  it("isolates notes and mutations by owner", async () => {
    await send("Private");
    const n = await one<{ id: string }>("SELECT id FROM notes");
    for (const action of [
      "note",
      "edit",
      "yesnote",
      "archive",
      "pin",
      "tags",
      "ntask",
      "nrem",
    ]) {
      await send(undefined, `${action}:${n.id}`, 2);
      expect(last().text).toContain("not found");
    }
    expect((await one<{ n: number }>("SELECT count(*) n FROM notes")).n).toBe(
      1,
    );
  });
  it("deduplicates concurrent and repeated update IDs", async () => {
    await Promise.all([
      send("same", undefined, 1, 100),
      send("same", undefined, 1, 100),
    ]);
    await send("same", undefined, 1, 100);
    expect((await one<{ n: number }>("SELECT count(*) n FROM notes")).n).toBe(
      1,
    );
  });
  it("does not acknowledge success on failed database mutation", async () => {
    const batch = vi
      .spyOn(env.DB, "batch")
      .mockRejectedValueOnce(new Error("db down"));
    await expect(send("important")).rejects.toThrow("db down");
    expect(replies).toHaveLength(0);
    batch.mockRestore();
    await send("important", undefined, 1, 1);
    expect((await one<{ n: number }>("SELECT count(*) n FROM notes")).n).toBe(
      1,
    );
  });
  it("acknowledges invalid callbacks with a safe error", async () => {
    await send(undefined, "note:bad;sql");
    expect(api.answer).toHaveBeenCalled();
    expect(last().text).toContain("invalid");
  });
  it("paginates and keeps search filters between pages", async () => {
    for (let i = 0; i < 10; i++) await send("Index " + i);
    await send("/search Index");
    expect(
      last()
        .buttons?.flat()
        .some((b) => b.callback_data === "notes:1"),
    ).toBe(true);
    await send(undefined, "notes:1");
    expect(
      last()
        .buttons?.flat()
        .filter((b) => b.callback_data.startsWith("note:")),
    ).toHaveLength(2);
  });
  it("enforces composite foreign keys and FTS delete triggers", async () => {
    await send("one");
    await send("two", undefined, 2);
    const n = await one<{ id: string }>("SELECT id FROM notes WHERE user_id=1");
    await env.DB.prepare("INSERT INTO tags(user_id,name) VALUES(2,?)")
      .bind("private")
      .run();
    await expect(
      env.DB.prepare(
        "INSERT INTO note_tags(note_id,tag_id,user_id) VALUES(?,1,1)",
      )
        .bind(n.id)
        .run(),
    ).rejects.toThrow();
  });
  it("retains safe idempotency tombstones on account deletion", async () => {
    await send("secret");
    await send(undefined, "deleteaccount");
    await send("DELETE MY DATA", undefined, 1, 500);
    expect((await one<{ n: number }>("SELECT count(*) n FROM notes")).n).toBe(
      0,
    );
    await send("DELETE MY DATA", undefined, 1, 500);
    expect((await one<{ n: number }>("SELECT count(*) n FROM users")).n).toBe(
      0,
    );
  });
});
describe("productivity", () => {
  it("creates tasks, changes state, due time and priority, and blocks other owners", async () => {
    await send(undefined, "addtask");
    await send("Study\nRead chapter");
    const t = await one<{ id: string }>("SELECT id FROM tasks");
    await send(undefined, `toggle:${t.id}`);
    expect(
      (
        await one<{ status: string; completed_at: number }>(
          "SELECT status,completed_at FROM tasks",
        )
      ).status,
    ).toBe("completed");
    await send(undefined, `toggle:${t.id}`);
    await send(undefined, `due:${t.id}`);
    await send("in 2 hours");
    await send(undefined, `prio:${t.id}:high`);
    await send(undefined, `task:${t.id}`);
    expect(last().text).toContain("high");
    await send(undefined, `toggle:${t.id}`, 2);
    expect(last().text).toContain("not found");
    await send(undefined, `yestask:${t.id}`);
    expect((await one<{ n: number }>("SELECT count(*) n FROM tasks")).n).toBe(
      0,
    );
  });
  it("requires reminder time confirmation and persists it", async () => {
    await send("Remind me in 10 minutes to study Python");
    expect(
      (await one<{ n: number }>("SELECT count(*) n FROM reminders")).n,
    ).toBe(0);
    const draft = await one<{ id: string }>("SELECT id FROM reminder_drafts");
    await send(undefined, `confirmrem:${draft.id}`);
    expect(
      (await one<{ n: number }>("SELECT count(*) n FROM reminders")).n,
    ).toBe(1);
    await send(undefined, `reminder:${draft.id}`, 2);
    expect(last().text).toContain("not found");
    await send(undefined, `cancelrem:${draft.id}`);
    expect(
      (await one<{ status: string }>("SELECT status FROM reminders")).status,
    ).toBe("cancelled");
  });
  it("saves supplied vocabulary and exports only own data", async () => {
    await send(undefined, "addvocab");
    await send("index | lookup structure | use an index | индекс | database");
    await send("/vocab");
    expect(last().text).toContain("lookup structure");
    await send("other secret", undefined, 2);
    await send(undefined, "export");
    expect(last().document).toContain("index");
    expect(last().document).not.toContain("other secret");
  });
  it("shows SQL statistics and persists timezone settings", async () => {
    await send("note");
    await send(undefined, "timezone");
    await send("Asia/Almaty");
    await send("/settings");
    expect(last().text).toContain("Asia/Almaty");
    await send("/stats");
    expect(last().text).toContain("Notes: 1");
  });
});
describe("reminder scheduler", () => {
  async function due() {
    await send("Remind me in 10 minutes to act");
    const d = await one<{ id: string }>("SELECT id FROM reminder_drafts");
    await send(undefined, `confirmrem:${d.id}`);
    await env.DB.prepare("UPDATE reminders SET due_at=1,next_attempt=1").run();
    vi.mocked(api.reply).mockClear();
    return d.id;
  }
  it("claims atomically and only delivers once across concurrent scheduled runs", async () => {
    await due();
    await Promise.all([processReminders(env, api), processReminders(env, api)]);
    expect(api.reply).toHaveBeenCalledTimes(1);
    expect(
      (await one<{ status: string }>("SELECT status FROM reminders")).status,
    ).toBe("delivered");
  });
  it("retries transient failures and respects retry_after", async () => {
    await due();
    vi.mocked(api.reply).mockRejectedValueOnce(new TelegramError(429, 300));
    await processReminders(env, api);
    const r = await one<{
      status: string;
      attempts: number;
      next_attempt: number;
    }>("SELECT * FROM reminders");
    expect(r.status).toBe("pending");
    expect(r.attempts).toBe(1);
    expect(r.next_attempt).toBeGreaterThan(Date.now() + 299000);
  });
  it("terminates permanent failures without marking delivered", async () => {
    await due();
    vi.mocked(api.reply).mockRejectedValueOnce(new TelegramError(403));
    await processReminders(env, api);
    expect(
      (
        await one<{ status: string; delivered_at: null }>(
          "SELECT * FROM reminders",
        )
      ).status,
    ).toBe("failed");
  });
  it("recovers expired leases, bounds retries, and respects reminder preferences", async () => {
    await due();
    await env.DB.prepare(
      "UPDATE reminders SET status='sending',lease_until=0,attempts=5",
    ).run();
    await processReminders(env, api);
    expect(api.reply).not.toHaveBeenCalled();
    expect(
      (await one<{ status: string }>("SELECT status FROM reminders")).status,
    ).toBe("failed");
  });
});

describe("additional reliability boundaries", () => {
  it("retries a transient webhook send without replaying the mutation", async () => {
    vi.mocked(api.reply).mockRejectedValueOnce(new TelegramError(503));
    await expect(send("Important", undefined, 1, 600)).rejects.toBeInstanceOf(
      TelegramError,
    );
    await send("Important", undefined, 1, 600);
    expect((await one<{ n: number }>("SELECT count(*) n FROM notes")).n).toBe(
      1,
    );
    expect(api.reply).toHaveBeenCalledTimes(2);
  });
  it("keeps invalid conversation input editable", async () => {
    await send(undefined, "timezone");
    await send("Not/AZone");
    expect(last().text).toContain("IANA");
    await send("Europe/London");
    expect(
      (await one<{ timezone: string }>("SELECT timezone FROM user_settings"))
        .timezone,
    ).toBe("Europe/London");
  });
  it("does not allow cross-owner reminder or task note links in SQL", async () => {
    await send("Private");
    await send("/start", undefined, 2);
    const n = await one<{ id: string }>("SELECT id FROM notes");
    await expect(
      env.DB.prepare(
        "INSERT INTO tasks(id,user_id,title,note_id,created_at,updated_at) VALUES(?,2,?,?,0,0)",
      )
        .bind("bad", "Task", n.id)
        .run(),
    ).rejects.toThrow("note owner mismatch");
  });
  it("searches tags with spaces", async () => {
    await send("Focus");
    const n = await one<{ id: string }>("SELECT id FROM notes");
    await send(undefined, `tags:${n.id}`);
    await send("deep work");
    await send('/search tag:"deep work"');
    expect(
      last()
        .buttons?.flat()
        .some((b) => b.callback_data === `note:${n.id}`),
    ).toBe(true);
  });
  it("rejects expired reminder confirmations", async () => {
    await send("Remind me in 10 minutes to act");
    const d = await one<{ id: string }>("SELECT id FROM reminder_drafts");
    await env.DB.prepare("UPDATE reminder_drafts SET expires=0").run();
    await send(undefined, `confirmrem:${d.id}`);
    expect(last().text).toContain("expired");
    expect(
      (await one<{ n: number }>("SELECT count(*) n FROM reminders")).n,
    ).toBe(0);
  });
  it("bounds per-user updates and leaves other users unaffected", async () => {
    await send("/start");
    await env.DB.prepare(
      "UPDATE user_settings SET rate_window=?,rate_count=30 WHERE user_id=1",
    )
      .bind(Date.now())
      .run();
    expect((await send("Too many")).status).toBe(429);
    expect((await send("Other user", undefined, 2)).status).toBe(200);
  });
  it("keeps paused reminders pending", async () => {
    await send("Remind me in 10 minutes to act");
    const d = await one<{ id: string }>("SELECT id FROM reminder_drafts");
    await send(undefined, `confirmrem:${d.id}`);
    await env.DB.prepare("UPDATE reminders SET next_attempt=1,due_at=1").run();
    await env.DB.prepare("UPDATE user_settings SET reminders_enabled=0").run();
    vi.mocked(api.reply).mockClear();
    await processReminders(env, api);
    expect(api.reply).not.toHaveBeenCalled();
    expect(
      (await one<{ status: string }>("SELECT status FROM reminders")).status,
    ).toBe("pending");
  });
});
