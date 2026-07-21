import { createHmac, timingSafeEqual } from 'node:crypto';

/** An `otp.status_update` webhook — WhatsApp reporting a message's delivery progress. */
export interface OtpStatusUpdateEvent {
  event: 'otp.status_update';
  /** The Meta/WhatsApp message id this status belongs to. */
  meta_message_id: string;
  status: 'delivered' | 'read' | 'failed';
}

/** An `account.low_balance` webhook — fired after a send when your balance drops below the floor. */
export interface AccountLowBalanceEvent {
  event: 'account.low_balance';
  /** Current credit balance, in USD. */
  balance: number;
}

/** Any webhook Authevo POSTs to your `webhook_url`, discriminated by `event`. */
export type WebhookEvent = OtpStatusUpdateEvent | AccountLowBalanceEvent;

/**
 * Verify an incoming Authevo webhook's signature. Every webhook we POST to your
 * `webhook_url` carries an `X-Authevo-Signature: sha256=<hmac>` header — an HMAC-SHA256 of
 * the RAW request body, keyed with your webhook signing secret. Always verify (with the
 * EXACT bytes you received — never a re-serialized object) before trusting a payload.
 *
 * ```ts
 * import { verifyWebhook, type WebhookEvent } from 'authevo';
 *
 * app.post('/webhooks/authevo', (req, res) => {
 *   const ok = verifyWebhook({
 *     payload: req.rawBody,                         // the raw request body (string/Buffer)
 *     signature: req.header('X-Authevo-Signature'),
 *     secret: process.env.AUTHEVO_WEBHOOK_SECRET!,
 *   });
 *   if (!ok) return res.sendStatus(401);
 *   const event = JSON.parse(req.rawBody.toString()) as WebhookEvent;
 *   // handle event.event === 'otp.status_update' | 'account.low_balance'
 *   res.sendStatus(200);
 * });
 * ```
 *
 * Uses a constant-time comparison. Returns `false` (never throws) on a missing/malformed
 * signature or secret.
 */
export function verifyWebhook(params: {
  /** The RAW request body exactly as received — do NOT re-stringify a parsed object. */
  payload: string | Uint8Array;
  /** The `X-Authevo-Signature` header value (e.g. `sha256=…`). */
  signature: string | null | undefined;
  /** Your webhook signing secret (returned at registration / rotated in the dashboard). */
  secret: string;
}): boolean {
  const { payload, signature, secret } = params;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const received = signature.slice(7);
  // Compare the hex digests in constant time (length check first — timingSafeEqual throws on
  // a length mismatch). Mirrors exactly how the API verifies its own inbound signatures.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
