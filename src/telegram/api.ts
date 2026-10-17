import type { Reply } from "../types";
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly retryAfter = 60,
  ) {
    super("Telegram request failed");
  }
  get transient(): boolean {
    return this.code === 429 || this.code >= 500;
  }
}
export class Telegram {
  constructor(
    private token: string,
    private transport: typeof fetch = fetch,
  ) {
    // workerd native fetch requires its global receiver, even when injected.
    this.transport = transport.bind(globalThis);
  }
  async call(method: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      throw new TelegramError(503);
    }
    let data: {
      ok?: boolean;
      error_code?: number;
      parameters?: { retry_after?: number };
      result?: unknown;
    };
    try {
      data = await response.json();
    } catch {
      throw new TelegramError(response.status >= 500 ? response.status : 502);
    }
    if (!response.ok || !data.ok)
      throw new TelegramError(
        data.error_code ?? response.status,
        data.parameters?.retry_after,
      );
    return data.result;
  }
  async reply(chat: number, reply: Reply): Promise<void> {
    if (reply.document) {
      const form = new FormData();
      form.set("chat_id", String(chat));
      form.set(
        "document",
        new Blob([reply.document], { type: "application/json" }),
        "second-brain-export.json",
      );
      let r: Response;
      try {
        r = await this.transport(
          `https://api.telegram.org/bot${this.token}/sendDocument`,
          { method: "POST", body: form, signal: AbortSignal.timeout(10000) },
        );
      } catch {
        throw new TelegramError(503);
      }
      const body = (await r.json()) as { ok?: boolean; error_code?: number };
      if (!r.ok || !body.ok)
        throw new TelegramError(body.error_code ?? r.status);
      return;
    }
    const chunks = reply.text.match(/[\s\S]{1,1900}/gu) ?? ["Done."];
    for (let i = 0; i < chunks.length; i++)
      await this.call("sendMessage", {
        chat_id: chat,
        text: chunks[i],
        link_preview_options: { is_disabled: true },
        ...(i === chunks.length - 1 && reply.buttons
          ? { reply_markup: { inline_keyboard: reply.buttons } }
          : {}),
      });
  }
  async answer(id: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id });
  }
}
