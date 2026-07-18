import { AuthevoError } from './errors.js';
import type {
  Account,
  AuthevoOptions,
  DeliverResult,
  SendResult,
  StatusResult,
  VerifyResult,
} from './types.js';

export { AuthevoError } from './errors.js';
export type {
  Account,
  AuthevoOptions,
  ClientTier,
  DeliverResult,
  OtpChannel,
  OtpStatus,
  SendResult,
  StatusResult,
  VerifyResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.authevo.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const E164 = /^\+[1-9]\d{6,14}$/;

/** `Retry-After` is delta-seconds or an HTTP-date — normalize to whole seconds. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, Math.ceil(secs));
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function assertPhone(phone: string): void {
  if (typeof phone !== 'string' || !E164.test(phone)) {
    throw new AuthevoError('invalid_phone', 'phone must be an E.164 number, e.g. "+201234567890".', 0);
  }
}

/**
 * The Authevo client.
 *
 * ```ts
 * import { Authevo } from 'authevo';
 * const authevo = new Authevo({ apiKey: process.env.AUTHEVO_API_KEY! });
 * await authevo.otp.send({ phone: '+201234567890' });
 * const { verified } = await authevo.otp.verify({ phone: '+201234567890', code: '123456' });
 * ```
 */
export class Authevo {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: AuthevoOptions) {
    if (!options || typeof options.apiKey !== 'string' || !options.apiKey) {
      throw new AuthevoError('invalid_config', 'An API key is required: new Authevo({ apiKey: "sk_…" }).', 0);
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new AuthevoError(
        'invalid_config',
        'No global fetch found. Use Node 18+, or pass a fetch implementation via the `fetch` option.',
        0,
      );
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = fetchImpl;
  }

  /** WhatsApp/Telegram OTP send + verify. Every method returns a promise — a bad input
   *  REJECTS with an `AuthevoError` (`invalid_phone`), it never throws synchronously. */
  readonly otp = {
    /** Generate and deliver a one-time code to `phone`. Backend picks the channel. */
    send: async (params: { phone: string }): Promise<SendResult> => {
      assertPhone(params.phone);
      const d = await this.#request<{ message_id: string; status: string; expires_in: number }>(
        'POST',
        '/v1/otp/send',
        { phone: params.phone },
      );
      return { messageId: d.message_id, status: d.status, expiresIn: d.expires_in };
    },

    /** Check a code the recipient entered. `verified: false` means wrong/expired. */
    verify: async (params: { phone: string; code: string }): Promise<VerifyResult> => {
      assertPhone(params.phone);
      const d = await this.#request<{ verified: boolean; attempts_remaining?: number }>(
        'POST',
        '/v1/otp/verify',
        { phone: params.phone, code: params.code },
      );
      return { verified: d.verified, attemptsRemaining: d.attempts_remaining };
    },

    /** Deliver a code YOU generated (e.g. from another auth provider) — no verify step. */
    deliver: async (params: { phone: string; code: string }): Promise<DeliverResult> => {
      assertPhone(params.phone);
      const d = await this.#request<{ message_id: string; status: string }>(
        'POST',
        '/v1/otp/deliver',
        { phone: params.phone, code: params.code },
      );
      return { messageId: d.message_id, status: d.status };
    },

    /** Look up the delivery status of a previous send by its `messageId`. */
    status: async (messageId: string): Promise<StatusResult> => {
      const d = await this.#request<{ status: StatusResult['status']; channel: StatusResult['channel']; created_at: string }>(
        'GET',
        `/v1/otp/status/${encodeURIComponent(messageId)}`,
      );
      return { status: d.status, channel: d.channel, createdAt: d.created_at };
    },
  };

  /** The authenticated account — tier, WhatsApp connection, and credit balance. */
  me(): Promise<Account> {
    return this.#request<{
      email: string;
      pk_key: string;
      tier: Account['tier'];
      waba_connected: boolean;
      credit_balance: number;
    }>('GET', '/v1/clients/me').then((d) => ({
      email: d.email,
      publishableKey: d.pk_key,
      tier: d.tier,
      wabaConnected: d.waba_connected,
      creditBalance: d.credit_balance,
    }));
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(this.#baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new AuthevoError(
        'network_error',
        timedOut ? 'The request timed out.' : 'Network error — could not reach the Authevo API.',
        0,
      );
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* tolerate empty bodies */
    }

    if (!res.ok) {
      const envelope =
        json && typeof json === 'object' && 'error' in json
          ? (json as { error?: { code?: string; message?: string } }).error
          : undefined;
      const retryAfter =
        res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : undefined;
      throw new AuthevoError(
        envelope?.code ?? `http_${res.status}`,
        envelope?.message ?? `Request failed with status ${res.status}.`,
        res.status,
        retryAfter,
      );
    }

    return (json as { data: T }).data;
  }
}

export default Authevo;
