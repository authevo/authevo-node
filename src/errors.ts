/**
 * The single error type every Authevo call rejects with. Inspect `code` (the API's
 * stable machine code, e.g. `INSUFFICIENT_CREDITS`, `RATE_LIMIT_EXCEEDED`, or a client
 * code like `network_error` / `invalid_config`), `status` (HTTP status, 0 for
 * network/config errors), and `retryAfter` (seconds, set on a 429 when the API sends it).
 */
export class AuthevoError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(code: string, message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = 'AuthevoError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    // Restore the prototype chain when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, AuthevoError.prototype);
  }
}
