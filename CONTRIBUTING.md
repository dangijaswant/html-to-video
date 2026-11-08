# Contributing

Thanks for taking a look. This repo is a working pipeline, not a library yet:
it turns HTML/CSS/GSAP into transparent video (WebM/WebP/MOV) via HyperFrames + FFmpeg,
with a local engine, a Cloudflare Workers front-end, and a GitHub Actions render job.

## How the pieces fit

```
studio/            static UI (GitHub Pages) — pick HTML + duration + formats
cf-api/            Cloudflare Worker — job queue (KV) + API the studio talks to
cf-engine/         Cloudflare Worker — Container wrapper around the Node engine
engine/            Node server (runs on CF Container / Railway / Fly / your machine)
                   captures PNG frames with HyperFrames, encodes with FFmpeg
render-hq-job.yml  GitHub Actions — captures frames, encodes, uploads release assets
```

Full notes in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local development

```bash
cd engine
npm install        # pulls hyperframes
npm run doctor     # sanity-checks HyperFrames + FFmpeg
npm run studio     # starts the engine on :8787
```

Requirements: Node 22+, FFmpeg on `PATH` (Windows: also `ffprobe`). The studio UI is in
`engine/studio/` when run locally, and in `studio/` on GitHub Pages.

Run the test suite (no dependencies):

```bash
node scripts/tests/patch-job-composition.test.mjs
```

The CI workflow (`.github/workflows/ci.yml`) runs the same command on every PR.

## Working on the engine

The composition patcher (`scripts/patch-job-composition.mjs`) is the seam between an
arbitrary HTML page and the HyperFrames capture. If you change it, add or update a fixture
in `scripts/tests/fixtures/` so the test suite pins the behavior.

Frame capture is driven by `npx hyperframes@0.7.106` — the version is pinned in the
`engine/server.mjs` constant `HF_VERSION` and in `render-hq-job.yml` (`HF_VERSION` env).
Bump both at the same time.

## Pull requests

- Keep PRs small; one change per PR.
- If a change touches the Worker or Container, note the deploy step (`wrangler deploy`)
  in the PR description — CI does not deploy for you.
- Fill in the PR template; especially "How I verified".

## Reporting issues

Use the issue template. For render failures, include:

- the HTML you submitted (or a link),
- the formats you requested,
- the job id (from the API response),
- the GHA run link (it's in the job's `logUrl`).
