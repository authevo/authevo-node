# Changelog

All notable changes to `authevo` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
