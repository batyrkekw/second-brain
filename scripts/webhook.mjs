const token = process.env.TELEGRAM_BOT_TOKEN,
  secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.argv[2];
if (!token || !secret || !url || !url.startsWith("https://"))
  throw Error(
    "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET securely; pass the deployed HTTPS Worker URL.",
  );
async function call(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok || !data.ok)
    throw Error(`Telegram rejected ${method} (${data.error_code ?? r.status})`);
  return data.result;
}
const base = new URL(url);
if (base.protocol !== "https:" || base.username || base.password)
  throw Error("Use an HTTPS Worker URL without credentials.");
const health = await fetch(new URL("/health", base));
if (!health.ok) throw Error("Health check failed.");
const authProbe = await fetch(new URL("/webhook", base), {
  method: "POST",
  headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
  body: JSON.stringify({ update_id: 0 }),
});
if (!authProbe.ok) throw Error("Webhook secret probe failed.");
await call("setWebhook", {
  url: new URL("/webhook", base).href,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
  ...(process.argv[3] ? { ip_address: process.argv[3] } : {}),
});
const info = await call("getWebhookInfo", {});
if (info.url !== new URL("/webhook", base).href)
  throw Error("Webhook URL mismatch.");
const bot = await call("getMe", {});
console.log(
  JSON.stringify({
    username: bot.username,
    url: info.url,
    pending_updates: info.pending_update_count,
    has_custom_certificate: info.has_custom_certificate,
  }),
);
// Telegram never returns secret_token. The authenticated probe verifies Worker configuration.
