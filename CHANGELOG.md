# Changelog

All notable changes to `authevo` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.4.0 (2026-09-12)

- Add `verifyWebhookV2` and `Authevo.verifyWebhookV2` for the API's new
  timestamped, delivery-ID-bound webhook signature. Verification rejects stale
  timestamps and uses constant-time signature comparison.
- Remove `me()` and the `Account` type. Secret integration keys now authenticate
  only the OTP/TOTP data plane and are deliberately rejected by dashboard account-
  management routes. Account metadata remains available through the authenticated
  dashboard rather than through an `sk_` credential.

## 0.3.1 (2026-09-11)

- Add and export `OtpTelegramLinkedEvent`, and include it in `WebhookEvent`, so
  the SDK now covers all three public webhook payloads: `otp.status_update`,
  `account.low_balance`, and `otp.telegram_linked`.
- Document the Telegram-link event's `phone_hash` and `redelivered` fields in
  the webhook example and inline API reference.

## 0.3.0 (2026-09-10)

- **Idempotency support on the two charged endpoints.** `otp.send` and `otp.deliver`
  now accept an optional `idempotencyKey`, forwarded as the `Idempotency-Key` header.
  The API has honoured that header on both routes for some time; this SDK never sent
  it, so the retry-after-timeout every integrator writes delivered a second message
  and billed a second time. Reuse the same key across retries of one logical send —
  within 24h the API replays the original response. A racing retry surfaces as
  `IDEMPOTENCY_KEY_IN_PROGRESS` (409). Keys are validated client-side (1-255
  printable ASCII) because a header-unsafe value otherwise fails as an opaque
  `network_error`. See the README's "Retries and idempotency".
- **`AuthevoError.telegramBotUrl`.** A `CHANNEL_NOT_LINKED` failure carries the
  single-use link that lets the recipient connect the Telegram fallback; the SDK was
  discarding it, which made the fallback the docs describe impossible to implement
  through the SDK at all. The URL is minted per failure, so it could not be
  reconstructed by the caller.

## 0.2.0 (2026-07-30)

- Add TOTP (RFC 6238) support — `totp.enroll` / `totp.verify` / `totp.disable` —
  Authevo's second, independent verification method (no send step, no message
  cost). Test-mode keys run a real-math sandbox against a fixed public demo
  secret (see the README's Test mode section for how this differs from `otp.*`'s
  always-`123456` sandbox).
- Expose `./package.json` in the package `exports` map, so tooling that reads a
  dependency's `package.json` (bundlers, some resolvers) can resolve it.
- Add continuous integration (type-check, unit tests, dual ESM/CJS build, and a
  guard that the published tarball actually ships the `.d.ts` type declarations).
- Add an OIDC "trusted publishing" release workflow: releases now publish from a
  GitHub Release with a signed provenance attestation and no stored npm token.
  See [`RELEASING.md`](./RELEASING.md).

## 0.1.0

- Initial release: the `Authevo` client (`otp.send` / `otp.verify` / `otp.deliver`
  / `otp.status`, `me()`), the `verifyWebhook` helper (constant-time HMAC-SHA256,
  also exposed as `Authevo.verifyWebhook`), and the typed `AuthevoError`. Dual
  ESM/CJS with bundled `.d.ts` types; test-mode aware (a test key transparently
  runs the sandbox).
