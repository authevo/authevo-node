import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { Authevo, verifyWebhook } from './index.js';

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
