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
   - **Allowed actions:** ✅ **tick "Allow `npm publish`"** — see below.
3. Save.

⚠️ **The "Allow `npm publish`" checkbox is required, and is easy to miss.** npm always
permits `npm stage publish` for a trusted publisher; publishing DIRECTLY is opt-in, and
`publish.yml` runs `npm publish --provenance --access public`. Left unticked, the connection
is created successfully and the release still fails — just with a different error than the
unconfigured one. (Cost a real release on 2026-09-10: trusted publishing had never been set
up at all, `npm publish` returned `404 ... you do not have permission - PUT /authevo`, and
0.3.0 had to be published by hand, so it carries no provenance attestation.)

⚠️ npm freezes the provider, org, repository and workflow filename once the connection is
created ("Cannot be changed later"). A typo means deleting the connection and making a new one.

**Package → Publishing access** is a separate setting and does not gate trusted publishing
(npm's own note: all options are compatible with OIDC). Prefer *"Require two-factor
authentication and disallow bypass 2fa tokens"* — but only AFTER a release has actually
published through CI, since that setting is what makes a manual `npm publish` fallback
possible. Do not remove the fallback before its replacement is proven.

Until this is configured, `.github/workflows/publish.yml` fails at `npm publish`
with an authentication error (there is no token fallback — by design).

### Verifying the connection without cutting a release

Re-run `publish.yml` (`workflow_dispatch`) against an ALREADY-published tag. npm refuses to
republish an existing version, which makes the error itself the test:

- `EPUBLISHCONFLICT` / "cannot publish over previously published version" → **auth works.**
- `404 ... you do not have permission` → still misconfigured.

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
