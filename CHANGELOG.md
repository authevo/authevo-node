# Changelog

All notable changes to `authevo` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.1 (unreleased)

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
