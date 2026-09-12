import { AuthevoError } from './errors.js';
import { verifyWebhook, verifyWebhookV2 } from './webhooks.js';
import type {
  AuthevoOptions,
  BoundPhoneClient,
  DeliverResult,
  SendResult,
  StatusResult,
  TotpDisableResult,
  TotpEnrollResult,
  TotpVerifyResult,
  VerifyResult,
} from './types.js';

export { AuthevoError } from './errors.js';
export { verifyWebhook, verifyWebhookV2 } from './webhooks.js';
export type {
  AccountLowBalanceEvent,
  OtpStatusUpdateEvent,
  OtpTelegramLinkedEvent,
  WebhookEvent,
} from './webhooks.js';
export type {
  AuthevoOptions,
  BoundOtpClient,
  BoundPhoneClient,
  BoundTotpClient,
  ClientTier,
  DeliverResult,
  OtpChannel,
  OtpStatus,
  SendResult,
  StatusResult,
  TotpDisableResult,
  TotpEnrollResult,
  TotpVerifyResult,
  VerifyResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.authevo.dev';
const DEFAULT_TIMEOUT_MS = 30_000;
const E164 = /^\+[1-9]\d{6,14}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;

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
 * An Idempotency-Key travels as an HTTP header, so it must be header-safe: a value with a
 * newline in it is a request-splitting hazard, and `fetch` rejects it with an opaque
 * TypeError that would surface here as a bogus `network_error`. Validated client-side
 * because the API takes the header raw. ASCII 0x21-0x7E, 1-255 chars — a superset of the
 * UUID most callers will use, and the same shape Stripe accepts.
 */
function assertIdempotencyKey(key: string): void {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
    throw new AuthevoError(
      'invalid_idempotency_key',
      'idempotencyKey must be 1-255 printable ASCII characters (a UUID is a good choice).',
      0,
    );
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
 *
 * // TOTP (a second, independent verification method — no send step):
 * const { qrCode } = await authevo.totp.enroll({ phone: '+201234567890' });
 * const totpResult = await authevo.totp.verify({ phone: '+201234567890', code: '654321' });
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
    /** Generate and deliver a one-time code to `phone`. Backend picks the channel.
     *
     * `idempotencyKey` makes a retry safe. This is a CHARGED call that also sends a real
     * message, so retrying after a timeout without one delivers a second code AND bills
     * you twice — and a timeout is exactly when you cannot tell whether the first attempt
     * landed. Reuse the SAME key for every retry of the same logical send (a fresh key per
     * attempt buys nothing); within 24h the API replays the original response instead of
     * re-running the send. A concurrent retry gets 409 `IDEMPOTENCY_KEY_IN_PROGRESS`.
     *
     * ```ts
     * const key = crypto.randomUUID();          // once per login attempt, NOT per retry
     * await authevo.otp.send({ phone, idempotencyKey: key });
     * ```
     */
    send: async (params: { phone: string; idempotencyKey?: string }): Promise<SendResult> => {
      assertPhone(params.phone);
      if (params.idempotencyKey !== undefined) assertIdempotencyKey(params.idempotencyKey);
      const d = await this.#request<{ message_id: string; status: string; expires_in: number }>(
        'POST',
        '/v1/otp/send',
        { phone: params.phone },
        params.idempotencyKey,
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

    /** Deliver a code YOU generated (e.g. from another auth provider) — no verify step.
     *  Charged per send on every tier, so `idempotencyKey` matters here for the same
     *  reason it does on `send` — see the note there. */
    deliver: async (params: { phone: string; code: string; idempotencyKey?: string }): Promise<DeliverResult> => {
      assertPhone(params.phone);
      if (params.idempotencyKey !== undefined) assertIdempotencyKey(params.idempotencyKey);
      const d = await this.#request<{ message_id: string; status: string }>(
        'POST',
        '/v1/otp/deliver',
        { phone: params.phone, code: params.code },
        params.idempotencyKey,
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

  /** TOTP (RFC 6238) two-factor — a second, independent verification method: no
   *  "send" step, no delivery cost. Enroll once per phone (scan the returned QR
   *  with any authenticator app), then verify the rotating 6-digit code it shows
   *  forever after. Every method returns a promise — a bad input REJECTS with an
   *  `AuthevoError` (`invalid_phone`), it never throws synchronously. */
  readonly totp = {
    /** Issue (or re-issue) a phone's TOTP secret. A CONFIRMED enrollment already in
     *  place rejects with a 409 `AuthevoError` unless `replace: true` is passed. */
    enroll: async (params: { phone: string; replace?: boolean }): Promise<TotpEnrollResult> => {
      assertPhone(params.phone);
      const d = await this.#request<{ secret: string; otpauth_url: string; qr_code: string; already_enrolled: boolean }>(
        'POST',
        '/v1/totp/enroll',
        { phone: params.phone, ...(params.replace !== undefined ? { replace: params.replace } : {}) },
      );
      return { secret: d.secret, otpauthUrl: d.otpauth_url, qrCode: d.qr_code, alreadyEnrolled: d.already_enrolled };
    },

    /** Check a 6-digit code from the user's authenticator app. `verified: false`
     *  means wrong/expired/already-used — the same code never verifies twice. */
    verify: async (params: { phone: string; code: string }): Promise<TotpVerifyResult> => {
      assertPhone(params.phone);
      const d = await this.#request<{ verified: boolean; attempts_remaining?: number; first_confirm?: boolean }>(
        'POST',
        '/v1/totp/verify',
        { phone: params.phone, code: params.code },
      );
      return { verified: d.verified, attemptsRemaining: d.attempts_remaining, firstConfirm: d.first_confirm };
    },

    /** Turn TOTP off for a phone — soft, idempotent, and reversible by enrolling
     *  again later. A disabled phone's `verify` calls behave as not-enrolled. */
    disable: async (params: { phone: string }): Promise<TotpDisableResult> => {
      assertPhone(params.phone);
      const d = await this.#request<{ disabled: boolean }>('POST', '/v1/totp/disable', { phone: params.phone });
      return { disabled: d.disabled };
    },
  };

  /**
   * Return OTP/TOTP operations permanently bound to one phone number.
   *
   * Use a phone loaded from your authenticated server-side user record. This removes
   * `phone` from each operation's arguments and ignores any runtime attempt to smuggle
   * in a replacement phone. AuthEvo cannot determine whether the value you pass here
   * came from a trusted session, so never bind directly from `req.body.phone`.
   */
  bindPhone(phone: string): BoundPhoneClient {
    assertPhone(phone);

    const bound: BoundPhoneClient = {
      otp: {
        send: (params) => this.otp.send({
          phone,
          ...(params?.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
        }),
        verify: (params) => this.otp.verify({ phone, code: params.code }),
        deliver: (params) => this.otp.deliver({
          phone,
          code: params.code,
          ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
        }),
      },
      totp: {
        enroll: (params) => this.totp.enroll({
          phone,
          ...(params?.replace !== undefined ? { replace: params.replace } : {}),
        }),
        verify: (params) => this.totp.verify({ phone, code: params.code }),
        disable: () => this.totp.disable({ phone }),
      },
    };

    Object.freeze(bound.otp);
    Object.freeze(bound.totp);
    return Object.freeze(bound);
  }

  /** Verify an incoming webhook's `X-Authevo-Signature`. Also exported standalone as
   *  `verifyWebhook` — exposed here for discoverability. See {@link verifyWebhook}. */
  static readonly verifyWebhook = verifyWebhook;

  /** Verify the timestamped, event-id-bound webhook signature and reject stale replays. */
  static readonly verifyWebhookV2 = verifyWebhookV2;

  async #request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(this.#baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : {}),
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
          ? (json as { error?: { code?: string; message?: string; telegram_bot_url?: string } }).error
          : undefined;
      const retryAfter =
        res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : undefined;
      throw new AuthevoError(
        envelope?.code ?? `http_${res.status}`,
        envelope?.message ?? `Request failed with status ${res.status}.`,
        res.status,
        retryAfter,
        // Carried on CHANNEL_NOT_LINKED. Single-use and minted per failure, so dropping
        // it here (as this SDK did) made the documented Telegram fallback unimplementable.
        typeof envelope?.telegram_bot_url === 'string' ? envelope.telegram_bot_url : undefined,
      );
    }

    return (json as { data: T }).data;
  }
}

export default Authevo;
