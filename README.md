# Second Brain 🧠

A private-chat Telegram knowledge manager built with strict TypeScript, Cloudflare Workers, D1 and Cron Triggers. No paid AI service, server, Docker, or polling process is required.

## What works

- Capture text without changing the original content; first-line titles.
- Notes: view, edit, confirm deletion, archive/restore, pin, categories, normalized custom tags.
- SQLite FTS5 search over title/content, exact phrases, tag/category/archive/pin filters, date sorting, pagination.
- Tasks with descriptions, priorities, completion/reopening, due times, today/overdue/upcoming views and pagination.
- Persistent reminders with explicit time confirmation, timezone support, atomic delivery leases, retries, cancellation, dismissal and deletion.
- Vocabulary with user-supplied definitions, examples, translations and tags; browsing and search.
- SQL statistics, timezone and language preferences, reminder pause, JSON export and confirmed account deletion.
- Secret-authenticated webhooks, runtime validation, per-user SQL ownership checks, rate limits, transactional update deduplication, bounded requests and safe error messages.

This initial release is implemented and deployed to Cloudflare. Deployment, D1 migrations, secrets, health, and webhook registration are verified; see the verification record for live-chat test status. See [verification](docs/VERIFICATION.md).

## Architecture

`POST /webhook` validates the Telegram secret and update structure. Only direct private chats are accepted; the sender must match the chat ID. Handlers plan database mutations and a Telegram reply. D1 commits the mutation batch and unique `update_id` together, then the reply is sent. A version guard rejects conflicting concurrent user mutations so Telegram can retry. Reply leases reduce concurrent duplicate sends.

`scheduled()` claims up to ten due reminders with a single conditional `UPDATE … RETURNING`, sends through Telegram, then records acceptance. Transient failures use exponential backoff, respecting Telegram's `retry_after`, with at most five attempts. Permanent errors stop retries.

- `src/index.ts`: HTTP, webhook processing, scheduled entry point.
- `src/app.ts`: conversation and callback routing.
- `src/services/`: notes, productivity, reminders, bounded export.
- `src/db.ts`: prepared statements and mutation planning.
- `src/telegram/`: HTTPS API wrapper and message/button helpers.
- `src/utils/`: input, FTS, date and IANA timezone validation.
- `migrations/`: reproducible schema, FTS triggers and delivery leases.
- `tests/`: SQLite integration and deterministic unit tests, no real credentials.

`AIProvider` is a future interface only. No provider is instantiated, no embeddings are generated, and notes are never sent to AI. A future provider must require explicit user opt-in. English message helpers are centralized in `src/telegram/ui.ts`; feature messages remain in handlers. Russian preference is stored, but a complete translation catalog is future work.

## Local development

Use Node.js **24 LTS** and npm. Dependencies are locked in `package-lock.json`; Git is needed for publication.

```sh
npm ci
cp .env.example .dev.vars
# Edit .dev.vars with a BotFather token and a random webhook secret.
npm run db:local
npm run dev
```

Wrangler serves [localhost:8787](http://localhost:8787). Check it with:

```sh
curl http://localhost:8787/health
```

A real Telegram webhook requires a public HTTPS URL. Local tests mock Telegram and do not need tokens. Do not point the production bot at a temporary local tunnel unless you intentionally want to replace its production webhook. `GET /health` checks runtime availability; it does not query D1 or prove Telegram connectivity. `POST /diagnostics/telegram` is an operator diagnostic protected by the same secret header as the webhook; it calls Telegram getMe and returns only connectivity status and the bot username. It does not send messages or read user data.

```sh
npm run typecheck
npm run lint
npm test
npm run test:runtime
npm run db:local
npm run build
# All of the above:
npm run check
```

The fast integration suite runs the real migrations and SQL through Node's built-in SQLite, with a small transactional D1 adapter. A separate actual-workerd smoke test exercises the built Worker, native fetch, D1 migrations, onboarding, note persistence, FTS5 and deduplication with Telegram HTTP fully mocked. Wrangler migration validation also runs against local workerd/D1. This is not a substitute for production verification.

## Create your Telegram bot

Open the official **@BotFather** in Telegram, use `/newbot`, and keep the resulting token private. Configure `/setcommands` with `start`, `notes`, `search`, `tasks`, `today`, `overdue`, `reminders`, `cancel_reminder`, `vocab`, `stats`, `settings`, `help`, and `cancel`.

Local secrets belong in `.dev.vars`, never in source, GitHub issues or chat. `node scripts/configure-secrets.mjs` securely copies the local token to production Worker secrets and generates a random webhook secret if needed; it never prints values. `.env.example` contains placeholders only. A suitable webhook secret can be generated with `openssl rand -hex 32`. Telegram accepts a secret of 1–256 characters from letters, digits, `_` and `-`.

## First production deployment

No paid product is enabled by the repository. Before creating resources, check that your intended account uses the **Workers Free** plan and review its existing resources and limits. Do not upgrade a plan as part of these commands.

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 list
# Only if this app's database does not already exist:
npx wrangler d1 create second-brain
```

For a fresh account, replace the existing `database_id` in `wrangler.jsonc` with the ID returned by Cloudflare. This checkout is already bound to the verified Second Brain production database; do not reuse its binding for another project. This ID is not a secret. For an account with multiple accounts, add the verified `account_id`. Do not use an unrelated database. The config is a single production environment; local development uses a separate SQLite store under `.wrangler/` even with the same binding name.

```sh
npm run db:remote
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run deploy
```

`secret put` prompts securely; enter the actual values there. Record the actual HTTPS Workers URL returned by deployment. Never register a guessed URL. An unauthenticated `/webhook` request should return 401 once both secrets exist.

To register and verify the webhook, supply the same two secrets as environment variables securely in your terminal (zsh supports hidden `read -s`; avoid literal tokens in shell history), then:

```sh
npm run webhook:setup -- https://YOUR-ACTUAL-WORKER.workers.dev
```

For this deployment, Telegram’s DNS resolver initially failed although Cloudflare and Google DNS resolved the hostname. Registration used the verified public IP `104.21.33.114` through Telegram’s supported `ip_address` option. The setup script accepts that as an optional second argument after the URL. If delivery fails after a network change, verify DNS and re-register without the IP or with a newly verified IP; TLS remains enabled.

The script checks health, probes the Worker using the configured secret, calls `setWebhook`, verifies `getWebhookInfo.url`, and prints the bot username and pending count without credentials. Telegram does **not** return the secret in `getWebhookInfo`; the probe validates the Worker side. Do not set `drop_pending_updates` unless you deliberately want to discard messages.

## Production verification

1. Run the setup script successfully and visit `/health`.
2. Send `/start` to the actual bot, save a unique note, search it, edit it, tag it and delete it.
3. From a second Telegram account, verify that the note cannot be read or modified.
4. Create a reminder in two minutes, confirm its displayed time and observe delivery. Test cancellation and task completion.
5. Inspect sanitized outcome summaries with `node scripts/tail-safe.mjs` (a two-minute session), or use `npx wrangler tail` only in a private terminal; check D1 tables in the intended account. Do not post log content containing personal information publicly.
6. Confirm that `wrangler.jsonc` contains the intended production DB ID and that all migrations applied. Use `npx wrangler d1 migrations list DB --remote`.

A scheduled handler can be exercised locally using `npm run dev -- --test-scheduled` and `curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'`. A local reminder sends real Telegram traffic if a real token is configured.

## Using the bot

Send ordinary text to save a note. Slash-prefixed messages are treated as commands; to save code beginning with `/`, choose **Add note** and prefix the content with a descriptive first line. Telegram formatting entities are not preserved, but the text itself is.

Search examples:

```text
PostgreSQL indexes
"exact phrase"
#learning category:Learning pinned:true
archived:true sort:oldest
sort:updated
```

Search is lexical, not semantic. Unquoted words use AND matching. Use `#learning` for single-token tags and `tag:"deep work"` for tags containing spaces. Categories are the eight built-in categories. Filters combine, and active search persists while paginating. `/notes` resets the note search.

Reminder examples:

```text
Remind me in 10 minutes to study Python
Remind me tomorrow at 18:00 to read
```

Or choose **Add reminder**, then `on 2026-12-20 at 09:00 | Call Alex`. Supported time expressions: `in N minutes`, `in N hours`, `in N days`, `tomorrow at HH:MM`, `on YYYY-MM-DD at HH:MM`. Dates must be in the future within five years. Calendar days follow the user's timezone; hours/minutes are elapsed time. Daylight-saving ambiguous/nonexistent local times are rejected with a request for another time. All reminder creation requires an explicit confirmation showing the timezone. Default timezone is clearly **UTC** until configured.

Conversation prompts expire after 15 minutes. `/cancel` cancels input. Tasks accept a title and optional description on subsequent lines. Vocabulary accepts `word | definition | example | translation | tags`; only the word is required.

## Update, recovery and rotation

For code-only changes: run `npm ci && npm run check`, commit, then `npm run deploy`. Apply new remote migrations **before** deploying code that depends on them. Keep migrations additive where possible. Existing Worker secrets remain configured; webhook registration does not need repeating if URL and secret are unchanged. Re-register after changing the webhook URL or webhook secret.

Before schema changes, review [D1 backups and Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). Free plan recovery currently retains seven days. An FTS virtual table can restrict full-database SQL export; verify backup restoration before relying on SQL dumps. Cloudflare deployment versions can be inspected with `npx wrangler deployments list`; roll back code with `npx wrangler rollback`. A code rollback does not undo a database migration. Restore data using D1 Time Travel only after reviewing the impact on changes since the restore point.

If a token is compromised: revoke/regenerate it through BotFather, update `TELEGRAM_BOT_TOKEN` using `wrangler secret put`, redeploy if required by your secret workflow, and run the setup/verification script again. For a webhook-secret compromise, generate a new random secret, update the Worker secret, and immediately re-register the webhook with the same new secret. Never log either value. Remove leaked credentials from history and revoke them rather than merely deleting the exposed text.

## Privacy, retention and limits

Data remains in D1 until explicitly deleted. Settings → Export sends owner-scoped JSON as a Telegram document. Export is bounded to approximately 1 MB and 25 data-page queries to protect the free runtime; larger exports require an operator-assisted owner-filtered database export. The bot does not silently truncate an export. This export includes notes, normalized tags/associations, tasks, reminders, vocabulary and settings.

Settings → Delete account data requires typing `DELETE MY DATA`. Cascades delete stored content and settings; minimal replay tombstones (update ID, numeric sender ID and timestamps) remain for up to seven days plus bounded cleanup backlog. Pending reply content is scrubbed on deletion. Cloudflare backups and messages already stored by Telegram follow those services' retention policies. Clear the Telegram chat separately. Pending in-flight notifications may still arrive during cancellation or deletion.

Notes are limited to 4,000 UTF-16 code units; task input to 1,000; vocabulary input to 2,000; reminder text to 1,000. Collections are limited to 10,000 items per user. Each user can submit up to 30 accepted updates per minute; callers are asked to retry after rate limiting. The database version guard makes these limits safe against concurrent mutations. Group chats, binary attachments, voice transcription, recurring reminders, semantic search, and full Russian translation are not implemented. Keep private chats with the bot secure; Telegram bot chats are not end-to-end encrypted.

Reminder Cron runs every minute, but scheduling is not perfectly punctual. Ten reminders per invocation bound work; bursts create backlog. Paused reminders retain their due dates and can arrive when re-enabled. Leases prevent ordinary concurrent delivery, but **exactly-once external delivery cannot be guaranteed**: a process crash after Telegram accepts a message and before D1 records it can cause a duplicate after lease expiry. The same limitation applies to webhook replies. Domain mutations are transactional and deduplicated for the seven-day event retention window. Transient reminder attempts use bounded exponential backoff, and permanent errors become failed. Failed reminders are visible in the reminders list; recreating one is manual.

## Free plan and costs

Checked against official documentation on 17 October 2026: Workers Free currently includes 100,000 requests/day and has tight CPU limits; D1 Free has 5 million rows read/day, 100,000 rows written/day, 5 GB total storage, a 500 MB per-database cap, and 50 queries per Worker invocation. FTS indexes and triggers add storage and row-write work. There are currently five Cron Triggers on Free; this project uses one. Exceeding free quotas can interrupt operation. Availability, quotas and commercial-use terms may change; upgrading may create usage charges. The deployment account was verified on Workers Free in its dashboard; no upgrade or paid resource was created.

Official references: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 SQL/FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/), [Telegram webhook API](https://core.telegram.org/bots/api#setwebhook).

## GitHub and license

Publish only to an intended repository owned by you. Create a **private** repository called `second-brain`, then:

```sh
git remote add origin https://github.com/YOUR-ACCOUNT/second-brain.git
git push -u origin main
```

No license is selected. The owner must choose a license before permitting public reuse. CI runs local verification without production credentials and does not deploy.
