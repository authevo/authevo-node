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

// Load this from your authenticated server-side user record, not the request body.
const auth = authevo.bindPhone(session.user.verifiedPhone);

// 1. Send a code
await auth.otp.send();

// 2. Verify what the user entered
const { verified } = await auth.otp.verify({ code: '123456' });
if (verified) {
  // sign the user in
}
```

Or TOTP — a second, independent verification method (no send step, no message cost):

```ts
// 1. Enroll once — show the QR to your user (any authenticator app: Google
// Authenticator, Authy, 1Password) or let them type in the secret manually.
const { qrCode, secret } = await auth.totp.enroll();

// 2. From then on, verify the rotating 6-digit code their app shows.
const { verified } = await auth.totp.verify({ code: '654321' });
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

### `bindPhone(phone)` → phone-bound client

Use `bindPhone` in authenticated routes so callers cannot choose another user's phone
on each OTP/TOTP operation. The phone must come from your trusted server-side session
or user record; never pass `req.body.phone` directly. The returned client removes
`phone` from every method and fixes all calls to the value supplied at binding time:

```ts
app.post('/account/totp/enroll', requireSession, async (req, res) => {
  const phone = req.user.verifiedPhone; // loaded by requireSession from your database
  const auth = authevo.bindPhone(phone);
  res.json(await auth.totp.enroll());
});
```

Your application owns its login session and user database, so the AuthEvo API cannot
independently prove that a submitted phone belongs to that session. `bindPhone` makes
the safe integration shape easy and prevents a later per-call phone override, but the
trusted lookup at the boundary remains mandatory.

### `otp.send({ phone, idempotencyKey?, language? })` → `{ messageId, status, expiresIn }`

Generates and delivers a one-time code. `phone` must be [E.164](https://en.wikipedia.org/wiki/E.164) (e.g. `+201234567890`).

`language` (`'en'` or `'ar'`) picks the WhatsApp message language. Omit it to use your
account's saved template language, else English. Any other value is rejected with a 400.

Pass one `idempotencyKey` per logical send and reuse it if that same request must be
retried — see [Retries and idempotency](#retries-and-idempotency).

### `otp.verify({ phone, code })` → `{ verified, attemptsRemaining?, retryAfterSeconds? }`

Checks a code. `verified: false` means wrong or expired; `attemptsRemaining` counts down to a temporary block.
The wrong guess that starts the block also returns `retryAfterSeconds` (how long until this phone can verify
again); verifies during the block throw a 429 `AuthevoError` whose `retryAfter` holds the remaining wait.

### `otp.deliver({ phone, code, idempotencyKey?, language? })` → `{ messageId, status }`

Deliver a code **you** generated (e.g. from another auth provider) — no verify step.
`language` works as on `send`.
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

Live `otp.send` and `otp.deliver` can incur a customer or provider charge and send a
real message. A timeout does **not** establish that no message was sent. A new request
without the original idempotency key can send another message and incur another charge.

`createIdempotencyKey()` produces an opaque, cryptographically random UUID. Create and
persist one key **before** the first call for each logical login or delivery attempt;
reuse the **same** key and identical request body for its retries, even after a process
restart. The API can replay a recorded result for 24 hours. A retry while the first
request is processing returns `IDEMPOTENCY_KEY_IN_PROGRESS` (HTTP 409); wait and retry
with the same key. If the outcome remains unknown, do not create a new key to force
another send. The SDK does not generate a key automatically because it cannot know
whether a later method call is a retry or a deliberate new send.
The key is not proof that WhatsApp delivered the message, or an unconditional
exactly-once guarantee if the API could not durably record its result; pause and
reconcile an unresolved outcome instead of looping.

```ts
import { createIdempotencyKey } from 'authevo';

// Create and store this with your login-attempt record before the first call.
const idempotencyKey = createIdempotencyKey();
const request = { phone, idempotencyKey };
await authevo.otp.send(request);

// If the application later retries this SAME attempt, load the stored key
// and use the identical body: await authevo.otp.send(request).
// A network timeout alone is not a reason to create a new key or auto-resend.
```

For `otp.deliver`, also reuse the same `code` with the key; changing the body with the
same key is rejected. A **deliberate resend** is a new operation: only after your
cooldown, consent and spend checks, create a *new* key. It may send and bill again.
Never derive a key solely from the phone number or keep one key for every login by
the same user; that would incorrectly collapse independent requests.

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

app.post('/webhooks/authevo', async (req, res) => {
  const deliveryId = req.header('X-Authevo-Id');
  const ok = verifyWebhookV2({
    payload: req.rawBody,                          // the raw request body (string/Buffer)
    signature: req.header('X-Authevo-Signature-V2'),
    timestamp: req.header('X-Authevo-Timestamp'),
    id: deliveryId,
    secret: process.env.AUTHEVO_WEBHOOK_SECRET!,
  });
  if (!ok) return res.sendStatus(401);

  // Atomically claim this delivery ID in durable storage. Example Redis contract:
  // SET authevo:webhook:<deliveryId> 1 NX EX 86400
  // A duplicate is authentic but must not run business logic twice. Return 200 so
  // Authevo considers the retry delivered.
  const firstDelivery = await deliveryIds.claimOnce(deliveryId!, { ttlSeconds: 86_400 });
  if (!firstDelivery) return res.sendStatus(200);

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

`verifyWebhookV2` uses a constant-time comparison, rejects timestamps older/newer than five minutes, and returns `false` rather than throwing. Signature verification prevents forged or stale requests; the delivery-ID claim prevents a valid retry from being processed twice. Use a shared Redis/database uniqueness primitive in production—not an in-memory set—so deduplication survives restarts and works across instances. The legacy body-only `verifyWebhook` remains available during migration.

The complete event union is:

- `otp.status_update` — `{ meta_message_id, status: 'delivered' | 'read' | 'failed' }`
- `account.low_balance` — `{ balance }`
- `otp.telegram_linked` — `{ phone_hash, redelivered }`

## License

MIT
