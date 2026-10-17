import type { Settings } from "./types";
export class Store {
  readonly writes: D1PreparedStatement[] = [];
  constructor(
    readonly db: D1Database,
    readonly uid: number,
    readonly now = Date.now(),
  ) {}
  stmt(sql: string, ...args: unknown[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...args);
  }
  async one<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return this.stmt(sql, ...args).first<T>();
  }
  async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return (await this.stmt(sql, ...args).all<T>()).results;
  }
  write(sql: string, ...args: unknown[]): void {
    this.writes.push(this.stmt(sql, ...args));
  }
  async settings(): Promise<Settings> {
    return (
      (await this.one<Settings>(
        "SELECT * FROM user_settings WHERE user_id=?",
        this.uid,
      )) ?? {
        user_id: this.uid,
        timezone: "UTC",
        language: "en",
        reminders_enabled: 1,
        state: null,
        state_expires: null,
      }
    );
  }
  state(value: string | null): void {
    this.write(
      "UPDATE user_settings SET state=?,state_expires=? WHERE user_id=?",
      value,
      value ? this.now + 900000 : null,
      this.uid,
    );
  }
  async limit(
    table: "notes" | "tasks" | "reminders" | "vocabulary",
  ): Promise<void> {
    const r = await this.one<{ n: number }>(
      `SELECT count(*) n FROM ${table} WHERE user_id=?`,
      this.uid,
    );
    if ((r?.n ?? 0) >= 10000) throw new Error("ACCOUNT_LIMIT");
  }
}
