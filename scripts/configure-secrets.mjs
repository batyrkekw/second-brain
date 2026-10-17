import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
// This file never prints secret values or interpolates them into command arguments.
process.loadEnvFile(".dev.vars");
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token))
  throw Error("Configure a valid BotFather token in .dev.vars first.");
let secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!secret || secret.startsWith("replace-")) {
  secret = randomBytes(32).toString("hex");
  const content = readFileSync(".dev.vars", "utf8").replace(
    /^TELEGRAM_WEBHOOK_SECRET=.*(?:\n|$)/m,
    "",
  );
  writeFileSync(
    ".dev.vars",
    content.trimEnd() + "\nTELEGRAM_WEBHOOK_SECRET=" + secret + "\n",
    { mode: 0o600 },
  );
}
if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret))
  throw Error(
    "Use a random webhook secret with 32–256 letters, digits, _ or -.",
  );
chmodSync(".dev.vars", 0o600);
const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
  input: JSON.stringify({
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_WEBHOOK_SECRET: secret,
  }),
  encoding: "utf8",
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  timeout: 120000,
});
if (result.status !== 0)
  throw Error(
    "Worker secret configuration failed. No secret values are displayed. Check Wrangler authentication and permissions.",
  );
console.log(
  "Production Worker secrets configured separately from local .dev.vars.",
);
