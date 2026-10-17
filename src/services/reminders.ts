import type { Env, Reminder } from "../types";
import { Telegram, TelegramError } from "../telegram/api";
export async function processReminders(
  env: Env,
  api = new Telegram(env.TELEGRAM_BOT_TOKEN),
  now = Date.now(),
): Promise<void> {
  // A lease is held longer than the entire sequential batch's network timeout budget.
  const token = crypto.randomUUID();
  const rows = (
    await env.DB.prepare(
      `UPDATE reminders SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id IN (SELECT r.id FROM reminders r JOIN user_settings u ON u.user_id=r.user_id WHERE u.reminders_enabled=1 AND r.attempts<5 AND ((r.status='pending' AND r.next_attempt<=?) OR (r.status='sending' AND r.lease_until<?)) ORDER BY r.next_attempt LIMIT 10) RETURNING *`,
    )
      .bind(token, now + 300000, now, now, now)
      .all<Reminder>()
  ).results;
  for (const r of rows) {
    try {
      await api.reply(r.user_id, {
        text: `⏰ ${r.content}`,
        buttons: [[{ text: "Dismiss", callback_data: `dismiss:${r.id}` }]],
      });
      await env.DB.prepare(
        "UPDATE reminders SET status='delivered',delivered_at=?,updated_at=?,lease_until=NULL WHERE id=? AND status='sending' AND lease_token=?",
      )
        .bind(Date.now(), Date.now(), r.id, token)
        .run();
    } catch (e) {
      const transient = e instanceof TelegramError && e.transient;
      const retry = transient && r.attempts < 5;
      const delay = Math.max(
        60000 * 2 ** r.attempts,
        e instanceof TelegramError ? e.retryAfter * 1000 : 0,
      );
      await env.DB.prepare(
        "UPDATE reminders SET status=?,next_attempt=?,last_error=?,updated_at=?,lease_until=NULL WHERE id=? AND status='sending' AND lease_token=?",
      )
        .bind(
          retry ? "pending" : "failed",
          Date.now() + delay,
          e instanceof TelegramError ? `telegram_${e.code}` : "delivery_error",
          Date.now(),
          r.id,
          token,
        )
        .run();
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE reminders SET status='failed',last_error='lease_exhausted' WHERE status='sending' AND lease_until<? AND attempts>=5",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM webhook_events WHERE update_id IN (SELECT update_id FROM webhook_events WHERE created_at<? LIMIT 500)",
    ).bind(now - 7 * 86400000),
  ]);
}
