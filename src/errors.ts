/**
 * The single error type every Authevo call rejects with. Inspect `code` (the API's
 * stable machine code, e.g. `INSUFFICIENT_CREDITS`, `RATE_LIMIT_EXCEEDED`, or a client
 * code like `network_error` / `invalid_config`), `status` (HTTP status, 0 for
 * network/config errors), and `retryAfter` (seconds, set on a 429 when the API sends it).
 *
 * `telegramBotUrl` is set on a `CHANNEL_NOT_LINKED` failure: WhatsApp delivery failed and
 * this recipient has not linked the Telegram fallback yet. Show that link to them — one
 * tap on Start in Telegram links the number, and the pending code is delivered there.
 * Without it the fallback the docs describe cannot be implemented through this SDK at all,
 * because the URL is single-use and mint-on-demand: there is no way to reconstruct it.
 */
export class AuthevoError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: number;
  readonly telegramBotUrl?: string;

  constructor(code: string, message: string, status: number, retryAfter?: number, telegramBotUrl?: string) {
    super(message);
    this.name = 'AuthevoError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.telegramBotUrl = telegramBotUrl;
    // Restore the prototype chain when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, AuthevoError.prototype);
  }
}
