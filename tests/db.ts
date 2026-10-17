import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function database(): D1Database {
  let queue: Promise<unknown> = Promise.resolve();
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("migrations").sort())
    db.exec(readFileSync("migrations/" + file, "utf8"));
  function prepared(sql: string, params: unknown[] = []): unknown {
    return {
      bind: (...args: unknown[]) => prepared(sql, args),
      first: async (column?: string) => {
        const row = db
          .prepare(sql)
          .get(...(params as (string | number | null)[]));
        return row ? (column ? row[column] : row) : null;
      },
      all: async () => ({
        results: db.prepare(sql).all(...(params as (string | number | null)[])),
        success: true,
        meta: {},
      }),
      run: async () => {
        const result = db
          .prepare(sql)
          .run(...(params as (string | number | null)[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare: prepared,
    batch: async (statements: { run(): Promise<unknown> }[]) => {
      const job = queue.then(async () => {
        db.exec("BEGIN");
        try {
          const out = [];
          for (const stmt of statements) out.push(await stmt.run());
          db.exec("COMMIT");
          return out;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      });
      queue = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
  } as unknown as D1Database;
}
