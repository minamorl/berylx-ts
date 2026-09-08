# Releasing

`@minamorl/berylx` is released by CI only. Nothing is published from a developer machine.

## The flow

1. Merge ordinary work into `main` with [Conventional Commits](https://www.conventionalcommits.org/)
   messages.
2. `.github/workflows/release.yml` runs on every push to `main`. Its
   `release-please` job opens or updates a **version pull request** that bumps
   `package.json` and `package-lock.json` and writes `CHANGELOG.md`.
3. Merging that version pull request pushes to `main`, which runs the workflow
   again. This time Release Please creates the git tag and the GitHub Release.
4. In that same run, the `publish` job sees `release_created == 'true'`, checks
   out `tag_name`, type-checks, tests, builds, and runs
   `npm publish --provenance --access public`.

`fix:` bumps the patch, `feat:` bumps the minor, and `!` or a `BREAKING CHANGE:`
footer bumps the major. Types such as `chore:` and `docs:` do not on their own
open a version pull request.

## First release

`.release-please-manifest.json` starts at `0.0.0`, so Release Please treats the
first run as an initial release and takes the version from `initial-version` in
`release-please-config.json`, which is `0.3.0`.

The first CI release therefore publishes `0.3.0`. The previous npm release was
`0.2.0`, so this initial automated release brings the registry into line with
the source tree.

Because `chore:` does not open a version pull request, the commit that adds this
release automation should be a releasable one, for example:

```text
feat(ci): add Release Please versioning and npm publishing
```

Once the first release is tagged, `initial-version` is no longer consulted and
every later version comes from the commits since the previous tag.

## Repository settings this depends on

- **Settings → Actions → General → Workflow permissions**: _Allow GitHub Actions
  to create and approve pull requests_ must be enabled, otherwise the
  `release-please` job cannot open the version pull request.
- **Settings → Secrets and variables → Actions**: a repository secret named
  `NPM_TOKEN` holding an npm granular access token with permission to publish
  `@minamorl/berylx`. Because the job publishes unattended, the token must be able to
  publish without an interactive 2FA challenge; when 2FA is required on the
  account, grant the granular token the bypass-2FA permission. The `publish`
  job reads it as `NODE_AUTH_TOKEN`; the value is never written into the
  repository. Add or rotate it through the GitHub Secrets UI.

## Known limitation: no CI on the version pull request

The `release-please` job authenticates with the built-in `GITHUB_TOKEN`, and
GitHub does not start new workflow runs for events created by that token. The
version pull request therefore shows no CI checks. This is deliberate: the
alternative is a personal access token. Nothing unverified reaches npm, because
the `publish` job type-checks, tests and builds the tagged commit before it
publishes.

## If publishing fails

Open the failed workflow run and use **Re-run failed jobs**. That reuses the
successful `release-please` job's outputs, so the `publish` job retries against
the same tag and version.

Do not expect a fresh `workflow_dispatch` run to republish. On a later run
Release Please finds the release already created, so `release_created` is not
set and the `publish` job is skipped.

## Checks that run

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:
a Prettier check over the manifests, config, docs and workflows, `npm run typecheck`, `npm test` and `npm run build`. The `publish` job
repeats the type-check, the tests and the build against the tagged commit
before publishing. It does not re-run the Prettier check.
