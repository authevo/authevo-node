import { describe, it, expect, expectTypeOf } from 'vitest';
import { createHmac } from 'node:crypto';
import { Authevo, verifyWebhook, verifyWebhookV2 } from './index.js';
import type {
  AccountLowBalanceEvent,
  OtpStatusUpdateEvent,
  OtpTelegramLinkedEvent,
  WebhookEvent,
} from './index.js';

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({ event: 'otp.status_update', meta_message_id: 'wamid.abc', status: 'delivered' });
const sign = (body: string, secret = SECRET) =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('verifyWebhook', () => {
  it('accepts a correctly-signed payload (string body)', () => {
    expect(verifyWebhook({ payload: BODY, signature: sign(BODY), secret: SECRET })).toBe(true);
  });

  it('accepts a Buffer/Uint8Array body signed identically to the API', () => {
    const buf = Buffer.from(BODY, 'utf8');
    expect(verifyWebhook({ payload: buf, signature: sign(BODY), secret: SECRET })).toBe(true);
  });

  it('rejects a tampered payload', () => {
    expect(verifyWebhook({ payload: BODY + ' ', signature: sign(BODY), secret: SECRET })).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyWebhook({ payload: BODY, signature: sign(BODY, 'other'), secret: SECRET })).toBe(false);
  });

  it('rejects a missing / malformed / prefix-less signature', () => {
    expect(verifyWebhook({ payload: BODY, signature: null, secret: SECRET })).toBe(false);
    expect(verifyWebhook({ payload: BODY, signature: undefined, secret: SECRET })).toBe(false);
    expect(verifyWebhook({ payload: BODY, signature: 'deadbeef', secret: SECRET })).toBe(false);
    expect(verifyWebhook({ payload: BODY, signature: 'sha256=zzzz', secret: SECRET })).toBe(false);
  });

  it('rejects an empty secret (never throws)', () => {
    expect(verifyWebhook({ payload: BODY, signature: sign(BODY), secret: '' })).toBe(false);
  });

  it('is also reachable as Authevo.verifyWebhook', () => {
    expect(Authevo.verifyWebhook({ payload: BODY, signature: sign(BODY), secret: SECRET })).toBe(true);
  });
});

describe('verifyWebhookV2', () => {
  const timestamp = '2000000000';
  const id = 'evt_abc123';
  const nowMs = Number(timestamp) * 1000;
  const signature = 'sha256=' + createHmac('sha256', SECRET)
    .update(`${id}.${timestamp}.${BODY}`)
    .digest('hex');

  it('accepts a fresh signature bound to the event id, timestamp, and raw body', () => {
    expect(verifyWebhookV2({ payload: BODY, signature, timestamp, id, secret: SECRET, nowMs })).toBe(true);
    expect(Authevo.verifyWebhookV2({ payload: BODY, signature, timestamp, id, secret: SECRET, nowMs })).toBe(true);
  });

  it('rejects stale, tampered, or re-bound deliveries', () => {
    expect(verifyWebhookV2({ payload: BODY, signature, timestamp, id, secret: SECRET, nowMs: nowMs + 301_000 })).toBe(false);
    expect(verifyWebhookV2({ payload: `${BODY} `, signature, timestamp, id, secret: SECRET, nowMs })).toBe(false);
    expect(verifyWebhookV2({ payload: BODY, signature, timestamp, id: 'evt_other', secret: SECRET, nowMs })).toBe(false);
  });
});

describe('S3-005 regression — hostile multi-byte signature never throws', () => {
  // A signature whose JS `.length` (UTF-16 code units) equals the expected 64-char hex digest
  // length, but whose UTF-8 byte length does not (any code point above U+007F is 2+ UTF-8
  // bytes). Before the fix, `Buffer.from(str)` (default utf8 encoding) desynced the byte length
  // actually passed to timingSafeEqual from the JS-string-length pre-check, throwing an uncaught
  // RangeError instead of returning `false` as documented.
  const hostileSignature = 'sha256=' + 'é'.repeat(64);
  // Byte-identical-length ASCII control: same 64-char length, wrong value, pure ASCII. Isolates
  // the bug to the UTF-16-vs-UTF-8 divergence specifically, not to signature correctness.
  const asciiWrongSignature = 'sha256=' + 'f'.repeat(64);

  it('verifyWebhook returns false, never throws, on a hostile non-ASCII signature', () => {
    expect(() =>
      verifyWebhook({ payload: BODY, signature: hostileSignature, secret: SECRET })
    ).not.toThrow();
    expect(verifyWebhook({ payload: BODY, signature: hostileSignature, secret: SECRET })).toBe(false);
  });

  it('verifyWebhook returns false on the byte-identical-length ASCII control', () => {
    expect(verifyWebhook({ payload: BODY, signature: asciiWrongSignature, secret: SECRET })).toBe(false);
  });

  it('verifyWebhookV2 returns false, never throws, on a hostile non-ASCII signature', () => {
    const timestamp = '2000000000';
    const id = 'evt_abc123';
    const nowMs = Number(timestamp) * 1000;
    expect(() =>
      verifyWebhookV2({ payload: BODY, signature: hostileSignature, timestamp, id, secret: SECRET, nowMs })
    ).not.toThrow();
    expect(
      verifyWebhookV2({ payload: BODY, signature: hostileSignature, timestamp, id, secret: SECRET, nowMs })
    ).toBe(false);
  });
});

describe('WebhookEvent', () => {
  it('covers all three documented webhook event payloads', () => {
    const events: WebhookEvent[] = [
      {
        event: 'otp.status_update',
        meta_message_id: 'wamid.abc',
        status: 'delivered',
      } satisfies OtpStatusUpdateEvent,
      {
        event: 'account.low_balance',
        balance: 1.25,
      } satisfies AccountLowBalanceEvent,
      {
        event: 'otp.telegram_linked',
        phone_hash: '5e884898da28047151d0e56f8dc6292',
        redelivered: true,
      } satisfies OtpTelegramLinkedEvent,
    ];

    expect(events.map((event) => event.event)).toEqual([
      'otp.status_update',
      'account.low_balance',
      'otp.telegram_linked',
    ]);
    const linked = events[2];
    if (linked?.event !== 'otp.telegram_linked') throw new Error('unexpected fixture');
    expectTypeOf(linked.phone_hash).toEqualTypeOf<string>();
    expectTypeOf(linked.redelivered).toEqualTypeOf<boolean>();
  });
});
