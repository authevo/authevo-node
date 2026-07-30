# authevo

Official Node.js / TypeScript SDK for the [Authevo](https://authevo.dev) verification API — two independent auth methods: one-time codes over WhatsApp (with an automatic Telegram fallback), and TOTP two-factor via any authenticator app (no message ever sent).

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

### `otp.send({ phone })` → `{ messageId, status, expiresIn }`

Generates and delivers a one-time code. `phone` must be [E.164](https://en.wikipedia.org/wiki/E.164) (e.g. `+201234567890`).

### `otp.verify({ phone, code })` → `{ verified, attemptsRemaining? }`

Checks a code. `verified: false` means wrong or expired; `attemptsRemaining` counts down to a temporary block.

### `otp.deliver({ phone, code })` → `{ messageId, status }`

Deliver a code **you** generated (e.g. from another auth provider) — no verify step.

### `otp.status(messageId)` → `{ status, channel, createdAt }`

Look up the delivery status of a previous send.

### `totp.enroll({ phone, replace? })` → `{ secret, otpauthUrl, qrCode, alreadyEnrolled }`

Issues (or re-issues) a phone's TOTP secret. `qrCode` is a ready-to-display PNG data URI (`<img src={qrCode}>`) — no QR-rendering library needed on your end; `otpauthUrl` and `secret` are there for a manual-entry fallback. A CONFIRMED enrollment already in place rejects with a 409 `AuthevoError` (`ALREADY_ENROLLED`) unless you pass `replace: true`.

### `totp.verify({ phone, code })` → `{ verified, attemptsRemaining?, firstConfirm? }`

Checks a 6-digit code from the user's authenticator app. `firstConfirm` is `true` only on the exact call that confirms a brand-new enrollment — a one-time "setup just completed" signal, since TOTP has no send step to hang it on otherwise.

### `totp.disable({ phone })` → `{ disabled }`

Turns TOTP off for a phone — soft and idempotent. A disabled phone's `verify` calls behave as not-enrolled; enrolling again later turns it back on.

### `me()` → `{ email, publishableKey, tier, wabaConnected, creditBalance }`

The authenticated account, including its current credit balance.

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

Common codes: `INSUFFICIENT_CREDITS`, `RATE_LIMIT_EXCEEDED`, `CHANNEL_NOT_LINKED`, `INVALID_API_KEY`, `ALREADY_ENROLLED` (TOTP re-enroll without `replace: true`), plus client-side `invalid_phone` / `invalid_config` / `network_error`.

## Webhooks

Authevo POSTs delivery-status and low-balance events to your `webhook_url`, each signed with an `X-Authevo-Signature: sha256=…` header (HMAC-SHA256 of the raw body, keyed with your webhook secret). Verify it with the **raw** body — never a re-serialized object — before trusting the payload:

```ts
import { verifyWebhook, type WebhookEvent } from 'authevo';

app.post('/webhooks/authevo', (req, res) => {
  const ok = verifyWebhook({
    payload: req.rawBody,                          // the raw request body (string/Buffer)
    signature: req.header('X-Authevo-Signature'),
    secret: process.env.AUTHEVO_WEBHOOK_SECRET!,
  });
  if (!ok) return res.sendStatus(401);

  const event = JSON.parse(req.rawBody.toString()) as WebhookEvent;
  if (event.event === 'otp.status_update') {
    // event.meta_message_id, event.status: 'delivered' | 'read' | 'failed'
  } else if (event.event === 'account.low_balance') {
    // event.balance
  }
  res.sendStatus(200);
});
```

`verifyWebhook` does a constant-time comparison and returns `false` (never throws) on a missing or malformed signature.

## License

MIT
