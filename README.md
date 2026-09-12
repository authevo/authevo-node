# authevo

Official Node.js / TypeScript SDK for the [Authevo](https://authevo.dev) verification API — two independent auth methods: one-time codes over WhatsApp (with automatic Telegram fallback after a one-time recipient link), and TOTP two-factor via any authenticator app (no message ever sent).

- **Typed** — full TypeScript types, no `any` at the edges.
- **Zero dependencies** — uses the built-in `fetch` (Node 18+).
- **Test mode built in** — use a **test** API key to run a sandbox for both methods: nothing is sent, nothing is charged.

## Install

```bash
npm install authevo
```

## Quickstart

```ts
import { Authevo } from 'authevo';

const authevo = new Authevo({ apiKey: process.env.AUTHEVO_API_KEY! });

// 1. Send a code
await authevo.otp.send({ phone: '+201234567890' });

// 2. Verify what the user entered
const { verified } = await authevo.otp.verify({ phone: '+201234567890', code: '123456' });
if (verified) {
  // sign the user in
}
```

Or TOTP — a second, independent verification method (no send step, no message cost):

```ts
// 1. Enroll once — show the QR to your user (any authenticator app: Google
// Authenticator, Authy, 1Password) or let them type in the secret manually.
const { qrCode, secret } = await authevo.totp.enroll({ phone: '+201234567890' });

// 2. From then on, verify the rotating 6-digit code their app shows.
const { verified } = await authevo.totp.verify({ phone: '+201234567890', code: '654321' });
```

CommonJS works too:

```js
const { Authevo } = require('authevo');
```

## Test mode

Create a **test** key in your [dashboard](https://dashboard.authevo.dev/en/keys) (Create key → Environment: Test). It runs the exact same code path for both auth methods, but the sandbox behaves differently for each:

```ts
const authevo = new Authevo({ apiKey: 'sk_your_test_key' });

// OTP: no WhatsApp message goes out, and the code is always 123456.
await authevo.otp.send({ phone: '+201234567890' });
await authevo.otp.verify({ phone: '+201234567890', code: '123456' }); // → { verified: true }

// TOTP: enroll always returns the SAME fixed, public demo secret (never a real,
// per-account one) — add it to any authenticator app to get a genuinely valid,
// real-math, rotating code. Nothing is written to your database, nothing billed.
const { secret } = await authevo.totp.enroll({ phone: '+201234567890' });
await authevo.totp.verify({ phone: '+201234567890', code: /* from your app */ '654321' });
```

## API

### `new Authevo(options)`

| option      | type              | default                     | notes                                              |
| ----------- | ----------------- | --------------------------- | -------------------------------------------------- |
| `apiKey`    | `string`          | —                           | **required.** Your secret `sk_…` key.              |
| `baseUrl`   | `string`          | `https://api.authevo.dev`   | override the API host.                             |
| `timeoutMs` | `number`          | `30000`                     | per-request timeout.                              |
| `fetch`     | `typeof fetch`    | global `fetch`              | inject a custom fetch (proxy/tests).              |

### `otp.send({ phone, idempotencyKey? })` → `{ messageId, status, expiresIn }`

Generates and delivers a one-time code. `phone` must be [E.164](https://en.wikipedia.org/wiki/E.164) (e.g. `+201234567890`).

`idempotencyKey` makes a retry safe — see [Retries and idempotency](#retries-and-idempotency).

### `otp.verify({ phone, code })` → `{ verified, attemptsRemaining? }`

Checks a code. `verified: false` means wrong or expired; `attemptsRemaining` counts down to a temporary block.

### `otp.deliver({ phone, code, idempotencyKey? })` → `{ messageId, status }`

Deliver a code **you** generated (e.g. from another auth provider) — no verify step.
Charged per send on every tier, so `idempotencyKey` matters here for the same reason
it does on `send` — see [Retries and idempotency](#retries-and-idempotency).

### `otp.status(messageId)` → `{ status, channel, createdAt }`

Look up the delivery status of a previous send.

### `totp.enroll({ phone, replace? })` → `{ secret, otpauthUrl, qrCode, alreadyEnrolled }`

Issues (or re-issues) a phone's TOTP secret. `qrCode` is a ready-to-display PNG data URI (`<img src={qrCode}>`) — no QR-rendering library needed on your end; `otpauthUrl` and `secret` are there for a manual-entry fallback. A CONFIRMED enrollment already in place rejects with a 409 `AuthevoError` (`ALREADY_ENROLLED`) unless you pass `replace: true`.

### `totp.verify({ phone, code })` → `{ verified, attemptsRemaining?, firstConfirm? }`

Checks a 6-digit code from the user's authenticator app. `firstConfirm` is `true` only on the exact call that confirms a brand-new enrollment — a one-time "setup just completed" signal, since TOTP has no send step to hang it on otherwise.

### `totp.disable({ phone })` → `{ disabled }`

Turns TOTP off for a phone — soft and idempotent. A disabled phone's `verify` calls behave as not-enrolled; enrolling again later turns it back on.

## Retries and idempotency

`otp.send` and `otp.deliver` both **cost money and send a real message**. A timeout is
precisely the case where you cannot tell whether the first attempt landed, so retrying
without an idempotency key delivers a second code to the recipient *and* bills you twice.

Pass an `idempotencyKey` and reuse the **same** key for every retry of the same logical
operation. Within 24 hours the API replays the original response instead of re-running
the send. A fresh key per attempt buys you nothing — the key is what ties the retry to
the original.

```ts
// One key per login attempt — generated BEFORE the first try, reused on every retry.
const idempotencyKey = crypto.randomUUID();

async function sendWithRetry(phone: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await authevo.otp.send({ phone, idempotencyKey });
    } catch (err) {
      if (err instanceof AuthevoError && err.code === 'network_error' && attempt < 2) continue;
      throw err;
    }
  }
}
```

A retry that races the original (the first call is still in flight) rejects with
`IDEMPOTENCY_KEY_IN_PROGRESS` (HTTP 409) — wait and retry with the same key.

The key must be 1–255 printable ASCII characters; a UUID is a good choice.

## Error handling

Every call rejects with an `AuthevoError`:

```ts
import { Authevo, AuthevoError } from 'authevo';

try {
  await authevo.otp.send({ phone: '+201234567890' });
} catch (err) {
  if (err instanceof AuthevoError) {
    console.error(err.code, err.status, err.message);
    if (err.code === 'RATE_LIMIT_EXCEEDED') {
      // Back off and retry. err.retryAfter is the seconds to wait *when* the API
      // includes a Retry-After header (otherwise undefined — fall back to your own delay).
    }
  }
}
```

Common codes: `INSUFFICIENT_CREDITS`, `RATE_LIMIT_EXCEEDED`, `CHANNEL_NOT_LINKED`, `INVALID_API_KEY`, `ALREADY_ENROLLED` (TOTP re-enroll without `replace: true`), `IDEMPOTENCY_KEY_IN_PROGRESS`, plus client-side `invalid_phone` / `invalid_config` / `invalid_idempotency_key` / `network_error`.

### The Telegram fallback

When WhatsApp delivery fails and the recipient has never linked Telegram, the error is
`CHANNEL_NOT_LINKED` and carries `err.telegramBotUrl`. Show that link to the recipient:
one tap on **Start** in Telegram links their number, and the pending code is delivered
there. The URL is single-use and minted for that failure, so there is nothing to cache
and no way to reconstruct it later.

```ts
try {
  await authevo.otp.send({ phone });
} catch (err) {
  if (err instanceof AuthevoError && err.code === 'CHANNEL_NOT_LINKED' && err.telegramBotUrl) {
    showLinkToUser(err.telegramBotUrl);
  }
}
```

## Webhooks

Authevo POSTs delivery-status, low-balance, and Telegram-link events to your `webhook_url`. Use the v2 signature, which binds the raw body to an event ID and timestamp and rejects stale replays:

```ts
import { verifyWebhookV2, type WebhookEvent } from 'authevo';

app.post('/webhooks/authevo', (req, res) => {
  const ok = verifyWebhookV2({
    payload: req.rawBody,                          // the raw request body (string/Buffer)
    signature: req.header('X-Authevo-Signature-V2'),
    timestamp: req.header('X-Authevo-Timestamp'),
    id: req.header('X-Authevo-Id'),
    secret: process.env.AUTHEVO_WEBHOOK_SECRET!,
  });
  if (!ok) return res.sendStatus(401);

  const event = JSON.parse(req.rawBody.toString()) as WebhookEvent;
  if (event.event === 'otp.status_update') {
    // event.meta_message_id, event.status: 'delivered' | 'read' | 'failed'
  } else if (event.event === 'account.low_balance') {
    // event.balance
  } else if (event.event === 'otp.telegram_linked') {
    // event.phone_hash, event.redelivered
  }
  res.sendStatus(200);
});
```

`verifyWebhookV2` uses a constant-time comparison, rejects timestamps older/newer than five minutes, and returns `false` rather than throwing. The legacy body-only `verifyWebhook` remains available during migration.

The complete event union is:

- `otp.status_update` — `{ meta_message_id, status: 'delivered' | 'read' | 'failed' }`
- `account.low_balance` — `{ balance }`
- `otp.telegram_linked` — `{ phone_hash, redelivered }`

## License

MIT
