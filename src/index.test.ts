import { describe, it, expect, vi } from 'vitest';
import { Authevo, AuthevoError } from './index.js';

/** Build a client whose fetch returns a canned response, capturing the request. */
function withFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  const client = new Authevo({ apiKey: 'sk_test', fetch: fetchImpl as unknown as typeof fetch });
  return { client, calls };
}

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Authevo', () => {
  it('requires an apiKey', () => {
    expect(() => new Authevo({} as never)).toThrow(AuthevoError);
    expect(() => new Authevo({ apiKey: '' })).toThrow(/API key is required/);
  });

  it('otp.send posts the phone and maps snake_case → camelCase', async () => {
    const { client, calls } = withFetch(() => ok({ message_id: 'm1', status: 'sent', expires_in: 300 }));
    const res = await client.otp.send({ phone: '+201234567890' });
    expect(res).toEqual({ messageId: 'm1', status: 'sent', expiresIn: 300 });
    expect(calls[0]!.url).toBe('https://api.authevo.dev/v1/otp/send');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ phone: '+201234567890' });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
  });

  it('otp.verify maps attempts_remaining', async () => {
    const { client } = withFetch(() => ok({ verified: false, attempts_remaining: 3 }));
    expect(await client.otp.verify({ phone: '+201234567890', code: '000000' })).toEqual({
      verified: false,
      attemptsRemaining: 3,
    });
  });

  it('otp.status GETs by id and maps created_at', async () => {
    const { client, calls } = withFetch(() =>
      ok({ status: 'verified', channel: 'whatsapp', created_at: '2026-07-18T00:00:00Z' }),
    );
    const res = await client.otp.status('m 1/x');
    expect(res.createdAt).toBe('2026-07-18T00:00:00Z');
    expect(calls[0]!.url).toBe('https://api.authevo.dev/v1/otp/status/m%201%2Fx'); // encoded
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('me() maps the account fields', async () => {
    const { client } = withFetch(() =>
      ok({ email: 'a@b.co', pk_key: 'pk_x', tier: 'per_message', waba_connected: true, credit_balance: 12.5 }),
    );
    expect(await client.me()).toEqual({
      email: 'a@b.co',
      publishableKey: 'pk_x',
      tier: 'per_message',
      wabaConnected: true,
      creditBalance: 12.5,
    });
  });

  it('rejects a non-E.164 phone before any request', async () => {
    const { client, calls } = withFetch(() => ok({}));
    await expect(client.otp.send({ phone: '01234' })).rejects.toMatchObject({ code: 'invalid_phone' });
    expect(calls).toHaveLength(0); // never hit the network
  });

  it('throws AuthevoError with the API code + 429 retryAfter', async () => {
    const { client } = withFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '42' },
        }),
    );
    await expect(client.otp.send({ phone: '+201234567890' })).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
      retryAfter: 42,
    });
  });

  it('maps a network failure to a network_error', async () => {
    const client = new Authevo({
      apiKey: 'sk_test',
      fetch: (async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
    });
    await expect(client.otp.send({ phone: '+201234567890' })).rejects.toMatchObject({
      code: 'network_error',
      status: 0,
    });
  });

  it('totp.enroll posts the phone and maps snake_case → camelCase', async () => {
    const { client, calls } = withFetch(() =>
      ok({ secret: 'ABC123', otpauth_url: 'otpauth://totp/x', qr_code: 'data:image/png;base64,x', already_enrolled: false }),
    );
    const res = await client.totp.enroll({ phone: '+201234567890' });
    expect(res).toEqual({ secret: 'ABC123', otpauthUrl: 'otpauth://totp/x', qrCode: 'data:image/png;base64,x', alreadyEnrolled: false });
    expect(calls[0]!.url).toBe('https://api.authevo.dev/v1/totp/enroll');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ phone: '+201234567890' });
  });

  it('totp.enroll only includes replace in the body when explicitly passed', async () => {
    const { client, calls } = withFetch(() =>
      ok({ secret: 'ABC123', otpauth_url: 'otpauth://totp/x', qr_code: 'x', already_enrolled: true }),
    );
    await client.totp.enroll({ phone: '+201234567890', replace: true });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ phone: '+201234567890', replace: true });
  });

  it('totp.verify maps attempts_remaining and first_confirm', async () => {
    const { client } = withFetch(() => ok({ verified: true, first_confirm: true }));
    expect(await client.totp.verify({ phone: '+201234567890', code: '123456' })).toEqual({
      verified: true,
      attemptsRemaining: undefined,
      firstConfirm: true,
    });
  });

  it('totp.disable posts the phone and maps the result', async () => {
    const { client, calls } = withFetch(() => ok({ disabled: true }));
    expect(await client.totp.disable({ phone: '+201234567890' })).toEqual({ disabled: true });
    expect(calls[0]!.url).toBe('https://api.authevo.dev/v1/totp/disable');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('totp.* rejects a non-E.164 phone before any request, same as otp.*', async () => {
    const { client, calls } = withFetch(() => ok({}));
    await expect(client.totp.enroll({ phone: '01234' })).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(client.totp.verify({ phone: '01234', code: '123456' })).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(client.totp.disable({ phone: '01234' })).rejects.toMatchObject({ code: 'invalid_phone' });
    expect(calls).toHaveLength(0);
  });

  it('totp.enroll surfaces a 409 ALREADY_ENROLLED the same way otp.* surfaces other API errors', async () => {
    const { client } = withFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'ALREADY_ENROLLED', message: 'Pass replace: true.' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(client.totp.enroll({ phone: '+201234567890' })).rejects.toMatchObject({
      code: 'ALREADY_ENROLLED',
      status: 409,
    });
  });

  it('honors a custom baseUrl (trailing slash trimmed)', async () => {
    const calls: string[] = [];
    const client = new Authevo({
      apiKey: 'sk_test',
      baseUrl: 'http://localhost:3000/',
      fetch: (async (url: string) => {
        calls.push(url);
        return ok({ message_id: 'm', status: 'sent', expires_in: 300 });
      }) as unknown as typeof fetch,
    });
    await client.otp.send({ phone: '+201234567890' });
    expect(calls[0]).toBe('http://localhost:3000/v1/otp/send');
  });
});
