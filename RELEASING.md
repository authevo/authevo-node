# Releasing `authevo`

Releases publish to npm from CI with a **provenance attestation** via OIDC
"trusted publishing" — no npm token is stored anywhere. The build always runs in
CI (`prepublishOnly`), so a release ships exactly what CI verified.

## One-time setup (once per package, on npmjs.com)

Before the first CI release will succeed, configure the trusted publisher:

1. npmjs.com → the **`authevo`** package → **Settings** → **Trusted Publishers** → **Add**.
2. Fill in:
   - **Provider:** GitHub Actions
   - **Organization or user:** `authevo`
   - **Repository:** `authevo-node`
   - **Workflow filename:** `publish.yml`
   - **Environment name:** *(leave blank)*
3. Save.

Until this is configured, `.github/workflows/publish.yml` fails at `npm publish`
with an authentication error (there is no token fallback — by design).

## Cutting a release

1. Make sure `main` is green in CI.
2. Bump the version (updates `package.json` **and** `package-lock.json`):
   ```sh
   npm version patch   # or minor / major — do NOT push the tag it creates yet
   ```
   …or edit the version by hand and run `npm install` to sync the lockfile.
3. Update [`CHANGELOG.md`](./CHANGELOG.md) — move the unreleased notes under the
   new version number.
4. Commit + push to `main`, then create a **GitHub Release** whose tag is
   `vX.Y.Z` (matching `package.json`). Publishing the Release triggers
   `publish.yml`, which builds and publishes that version to npm with provenance.
5. Verify: `npm view authevo version` shows the new version, and the npm page shows
   the green **"Provenance"** badge linking back to this repo + the release run.

## Notes

- Trusted publishing needs npm ≥ 11.5.1; the workflow upgrades npm before publishing.
- The version in `package.json` is the source of truth for what gets published —
  npm rejects re-publishing an already-published version, so always bump first.
- CI (`ci.yml`) also fails if the packed tarball is missing `dist/index.d.ts`,
  guarding against the type-declarations-silently-dropped class of bug.
