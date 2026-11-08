# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-11-08

### Added
- MIT license (repo was previously unlicensed).
- CI workflow (`.github/workflows/ci.yml`): runs the composition-patcher test suite
  on push to `main` and on every PR.
- Test suite for `scripts/patch-job-composition.mjs` with fixtures (`scripts/tests/`).
- Contributor tooling: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue + PR templates,
  Dependabot (npm + GitHub Actions).
- `docs/ARCHITECTURE.md`: end-to-end data flow and version-pinning rules.
- Root `package.json` so `npm test` works from the repo root.
- Upgraded README: quick start, CLI encode, engine API reference, repo layout, deploy notes.

### Changed
- README rewritten around the actual pipeline (studio → Worker API → GHA render → release assets).
