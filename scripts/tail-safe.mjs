import { spawn } from "node:child_process";
// Do not print Wrangler's raw event payloads: they may contain request headers.
const child = spawn(
  process.execPath,
  ["node_modules/wrangler/wrangler-dist/cli.js", "tail", "--format=json"],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let pending = "";
child.stdout.on("data", (chunk) => {
  pending += chunk.toString();
  if (/Connected to|Successfully created tail/.test(chunk.toString()))
    console.log("Safe tail connected.");
  // Wrangler emits complete, pretty-printed JSON objects separated by newlines.
  for (;;) {
    const start = pending.indexOf("{");
    if (start < 0) {
      pending = "";
      break;
    }
    if (start > 0) pending = pending.slice(start);
    let depth = 0,
      quoted = false,
      escaped = false,
      end = -1;
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) break;
    try {
      const event = JSON.parse(pending.slice(0, end));
      console.log(
        JSON.stringify({
          outcome: event.outcome,
          timestamp: event.eventTimestamp,
          cpu_ms: event.cpuTime,
          wall_ms: event.wallTime,
          errors: (event.logs ?? []).flatMap((l) =>
            (l.message ?? []).flatMap((m) => {
              try {
                const item = JSON.parse(m);
                return ["webhook_failed", "scheduler_failed"].includes(
                  item.event,
                )
                  ? [
                      {
                        event: item.event,
                        telegram_code:
                          typeof item.telegram_code === "number"
                            ? item.telegram_code
                            : undefined,
                        error_type: [
                          "Error",
                          "TypeError",
                          "AbortError",
                          "TimeoutError",
                        ].includes(item.error_type)
                          ? item.error_type
                          : "other",
                      },
                    ]
                  : [];
              } catch {
                return [];
              }
            }),
          ),
          error_events: (event.logs ?? []).filter((l) =>
            (l.message ?? []).some(
              (m) =>
                typeof m === "string" &&
                /webhook_failed|scheduler_failed/.test(m),
            ),
          ).length,
        }),
      );
    } catch {
      console.log("Unparsed tail event omitted.");
    }
    pending = pending.slice(end);
  }
  if (pending.length > 1000000) pending = "";
});
child.stderr.on("data", () => {});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// This is a local diagnostic timeout, never a reminder scheduler.
setTimeout(stop, 120000).unref();
child.on("exit", (code) => {
  if (code && code !== 143) console.log("Tail session ended.");
});
