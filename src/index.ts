import { Store } from "./db";
import { handle } from "./app";
import { Telegram, TelegramError } from "./telegram/api";
import type { Env, Reply } from "./types";
import { InputError, validateUpdate } from "./utils/input";
import { processReminders } from "./services/reminders";
async function authenticate(
  actual: string,
  expected: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(actual)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
export async function webhook(
  request: Request,
  env: Env,
  api = new Telegram(env.TELEGRAM_BOT_TOKEN),
): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN)
    return new Response("Not configured", { status: 503 });
  if (
    !(await authenticate(
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
      env.TELEGRAM_WEBHOOK_SECRET,
    ))
  )
    return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("Content-Length") ?? 0) > 32768)
    return new Response("Too large", { status: 413 });
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response("Invalid update", { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return new Response("Too large", { status: 413 });
      }
      chunks.push(r.value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    raw = new TextDecoder().decode(joined);
  } catch {
    return new Response("Invalid body", { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const u = validateUpdate(parsed);
  if (!u) return new Response("Invalid update", { status: 400 });
  const uid = u.callback_query?.from.id ?? u.message?.from.id;
  const chat = u.callback_query?.message?.chat ?? u.message?.chat;
  if (!uid || !chat || chat.type !== "private" || chat.id !== uid)
    return new Response("Ignored");
  const s = new Store(env.DB, uid);
  let event = await s.one<{ reply: string; delivered: number }>(
    "SELECT reply,delivered FROM webhook_events WHERE update_id=?",
    u.update_id,
  );
  if (u.callback_query) {
    try {
      await api.answer(u.callback_query.id);
    } catch (e) {
      if (!(e instanceof TelegramError) || e.transient) throw e;
    }
  }
  if (!event) {
    const rate = await s.one<{
      rate_window: number;
      rate_count: number;
      version: number;
    }>(
      "SELECT rate_window,rate_count,version FROM user_settings WHERE user_id=?",
      uid,
    );
    if (rate && s.now - rate.rate_window < 60000 && rate.rate_count >= 30)
      return new Response("Rate limited", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    let result: Reply;
    try {
      result = await handle(s, u.message?.text, u.callback_query?.data);
    } catch (e) {
      if (
        !(e instanceof InputError) &&
        !(e instanceof Error && e.message === "ACCOUNT_LIMIT")
      )
        throw e;
      s.writes.length = 0;
      result = {
        text:
          e instanceof InputError
            ? e.message + "\nTry again, or /cancel."
            : "Your account has reached the 10,000 item limit for this collection. Export or delete some items.",
      };
    }
    // Event and every domain mutation commit atomically. Unique update_id rolls back a concurrent replay.
    const batch = [
      s.stmt(
        "INSERT INTO users(id,created_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
        uid,
        s.now,
      ),
      s.stmt(
        "INSERT INTO user_settings(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING",
        uid,
      ),
      s.stmt(
        "UPDATE user_settings SET version=CASE WHEN version=? THEN version+1 ELSE -1 END WHERE user_id=?",
        rate?.version ?? 0,
        uid,
      ),
      s.stmt(
        "INSERT INTO webhook_events(update_id,user_id,created_at,reply) VALUES(?,?,?,?)",
        u.update_id,
        uid,
        s.now,
        JSON.stringify(result),
      ),
      s.stmt(
        "UPDATE user_settings SET rate_count=CASE WHEN rate_window>? THEN rate_count+1 ELSE 1 END,rate_window=CASE WHEN rate_window>? THEN rate_window ELSE ? END WHERE user_id=?",
        s.now - 60000,
        s.now - 60000,
        s.now,
        uid,
      ),
      ...s.writes,
    ];
    try {
      await env.DB.batch(batch);
      event = { reply: JSON.stringify(result), delivered: 0 };
    } catch (e) {
      event = await s.one(
        "SELECT reply,delivered FROM webhook_events WHERE update_id=?",
        u.update_id,
      );
      if (!event) throw e;
    }
  }
  if (!event.delivered) {
    const lease = crypto.randomUUID();
    const claimed = await s
      .stmt(
        "UPDATE webhook_events SET lease_until=?,lease_token=? WHERE update_id=? AND delivered=0 AND (lease_until IS NULL OR lease_until<?) RETURNING update_id",
        Date.now() + 120000,
        lease,
        u.update_id,
        Date.now(),
      )
      .first();
    if (!claimed) return new Response("Delivery in progress", { status: 503 });
    try {
      await api.reply(uid, JSON.parse(event.reply) as Reply);
    } catch (e) {
      if (e instanceof TelegramError && !e.transient) {
        await s
          .stmt(
            "UPDATE webhook_events SET delivered=1,reply=? WHERE update_id=?",
            JSON.stringify({ text: "Delivery rejected by Telegram." }),
            u.update_id,
          )
          .run();
        return new Response("Delivery rejected");
      }
      await s
        .stmt(
          "UPDATE webhook_events SET lease_until=NULL WHERE update_id=? AND lease_token=?",
          u.update_id,
          lease,
        )
        .run();
      throw e;
    }
    await s
      .stmt(
        "UPDATE webhook_events SET delivered=1,reply=? WHERE update_id=?",
        JSON.stringify({ text: "Processed" }),
        u.update_id,
      )
      .run();
  }
  return new Response("OK");
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return Response.json({ status: "ok", service: "second-brain" });
    if (path === "/diagnostics/telegram" && request.method === "POST") {
      if (
        !env.TELEGRAM_WEBHOOK_SECRET ||
        !(await authenticate(
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
          env.TELEGRAM_WEBHOOK_SECRET,
        ))
      )
        return new Response("Unauthorized", { status: 401 });
      try {
        const bot = (await new Telegram(env.TELEGRAM_BOT_TOKEN).call(
          "getMe",
          {},
        )) as { username?: string };
        return Response.json({ telegram: "ok", username: bot.username });
      } catch (error) {
        return Response.json(
          {
            telegram: "failed",
            code: error instanceof TelegramError ? error.code : 0,
          },
          { status: 503 },
        );
      }
    }
    if (path === "/webhook" && request.method === "POST") {
      try {
        return await webhook(request, env);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "webhook_failed",
            error_type: error instanceof Error ? error.name : "unknown",
            telegram_code:
              error instanceof TelegramError ? error.code : undefined,
          }),
        );
        return new Response("Temporary failure; retry later", { status: 503 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    try {
      await processReminders(env);
    } catch {
      console.error(JSON.stringify({ event: "scheduler_failed" }));
      throw new Error("Scheduler failed");
    }
  },
};
