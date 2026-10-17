import { describe, it, expect, vi } from "vitest";
import { Telegram, TelegramError } from "../src/telegram/api";
describe("Telegram transport", () => {
  it("splits long Unicode messages and attaches buttons to the final chunk only", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true, result: {} })),
      );
    const api = new Telegram("placeholder", fetcher as typeof fetch);
    await api.reply(1, {
      text: "🧠".repeat(4000),
      buttons: [[{ text: "Menu", callback_data: "home" }]],
    });
    const payloads = fetcher.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.every((p) => p.text.length <= 4096)).toBe(true);
    expect(payloads[0].reply_markup).toBeUndefined();
    expect(payloads.at(-1).reply_markup).toBeDefined();
    expect(payloads.map((p) => p.text).join("")).toBe("🧠".repeat(4000));
  });
  it("exposes safe structured rate limits without private payloads", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 180 },
        }),
        { status: 429 },
      ),
    );
    const api = new Telegram("placeholder", fetcher as typeof fetch);
    await expect(
      api.call("sendMessage", { text: "private" }),
    ).rejects.toMatchObject({ code: 429, retryAfter: 180 });
  });
  it("turns network failures into retryable errors", async () => {
    const api = new Telegram(
      "placeholder",
      vi.fn().mockRejectedValue(new Error("network")) as typeof fetch,
    );
    await expect(api.call("sendMessage", {})).rejects.toBeInstanceOf(
      TelegramError,
    );
  });
});

describe("workerd fetch receiver", () => {
  it("binds native fetch to the global receiver instead of the Telegram instance", async () => {
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, result: { username: "test" } }),
        ),
      );
    } as typeof fetch;
    const api = new Telegram("placeholder", strictFetch);
    await expect(api.call("getMe", {})).resolves.toEqual({ username: "test" });
  });
});
