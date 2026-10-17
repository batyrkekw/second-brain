import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
// Use exactly the workerd/Miniflare pair supplied by the locked Wrangler version.
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
);
let sends = 0;
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        modules: true,
        scriptPath: "dist/index.js",
        compatibilityDate: "2026-10-17",
        bindings: {
          TELEGRAM_BOT_TOKEN: "123:test",
          TELEGRAM_WEBHOOK_SECRET: "test-secret",
        },
        d1Databases: { DB: "runtime-smoke" },
        outboundService: async (request) => {
          const url = new URL(request.url);
          assert.equal(url.hostname, "api.telegram.org");
          if (url.pathname.endsWith("/sendMessage")) sends++;
          return Response.json({
            ok: true,
            result: { username: "runtime_test_bot" },
          });
        },
      },
    ],
  }),
);
try {
  await runtime.ready;
  const db = await runtime.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    await db.exec(
      readFileSync("migrations/" + file, "utf8")
        .replace(/^--.*$/gm, "")
        .trim(),
    );
  async function send(update_id, text) {
    return runtime.dispatchFetch("https://example.com/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
      body: JSON.stringify({
        update_id,
        message: {
          message_id: update_id,
          from: { id: 1 },
          chat: { id: 1, type: "private" },
          text,
        },
      }),
    });
  }
  assert.equal((await send(1, "/start")).status, 200);
  assert.equal((await send(2, "Runtime FTS note")).status, 200);
  assert.equal((await send(2, "Runtime FTS note")).status, 200);
  assert.equal(sends, 2);
  const count = await db.prepare("SELECT count(*) n FROM notes").first();
  assert.equal(count.n, 1);
  const found = await db
    .prepare("SELECT count(*) n FROM notes_fts WHERE notes_fts MATCH 'Runtime'")
    .first();
  assert.equal(found.n, 1);
  const result = await runtime.dispatchFetch(
    "https://example.com/diagnostics/telegram",
    {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
    },
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).username, "runtime_test_bot");
  console.log(
    "workerd smoke passed: migrations, native fetch, onboarding, note persistence, FTS5, duplicate updates, protected diagnostic.",
  );
} finally {
  await runtime.dispose();
}
