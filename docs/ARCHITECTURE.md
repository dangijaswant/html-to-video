# Architecture

End-to-end path from "paste HTML" to "download a transparent video".

## Components

```
┌──────────────┐      ┌──────────────┐      ┌─────────────────┐
│  studio/     │ HTTP │   cf-api/    │ KV   │  GitHub Actions │
│  (Pages UI)  │──────▶ (Worker:     │──────▶  render-hq-job  │
└──────────────┘      │ job queue)   │      │  (renders)      │
                      └──────┬───────┘      └────────┬────────┘
                             │ job status/artifacts  │ release assets
                             ▼                       ▼
                      engine API ◀─────────── (gh release download)
                      /api/jobs/:id
```

- **`studio/`** — static pages served from GitHub Pages. Talks to the
  `cf-api` Worker; falls back to a local `engine` server on `127.0.0.1:8787`
  when run locally.
- **`cf-api/`** — Cloudflare Worker + KV. Stores jobs, exposes
  `POST /api/jobs`, `GET /api/jobs/:id`, `POST /api/internal/jobs/:id/status`,
  `POST /api/internal/jobs/:id/artifacts`. Triggers GHA via `repository_dispatch`.
- **`cf-engine/`** — Cloudflare Worker that wraps the Node engine in a paid
  Container (Durable Object), exposing the same engine API on a `*.workers.dev`
  URL. Free-tier alternative: the `engine/` Node server on Railway/Fly/your
  machine.
- **`engine/`** — Node + HyperFrames + FFmpeg. Captures a PNG frame sequence
  from the composition, encodes it (VP9 WebM / lossless WebP / ProRes 4444),
  serves `/api/render` (local path) and static files.
- **`.github/workflows/render-hq-job.yml`** — on `repository_dispatch`,
  fetches the job's HTML from `cf-api`, runs `scripts/patch-job-composition.mjs`
  to normalize it into a HyperFrames composition, captures frames, encodes,
  uploads the outputs as a GitHub Release, and reports the artifact URLs back
  to `cf-api`.

## Key contracts

1. **Job JSON** (what `cf-api` stores and what the patcher reads):
   ```json
   { "id", "width", "height", "duration", "fps", "formats": ["webm"|"webp"|"mov"|"mov-premul"], "html" }
   ```
2. **Composition patching** (`scripts/patch-job-composition.mjs`):
   wraps bare HTML in a `#root`/`#main-clip` HyperFrames composition and
   overwrites all `data-width/height/duration/fps` attributes + the viewport
   meta + CSS pixel sizes. Idempotent: if the HTML already has `#root` and a
   `clip`, it only retimes — never double-wraps.
3. **Engine API** (`engine/server.mjs`): `GET /api/health`,
   `GET /api/template/{aether,music-player,default}`,
   `POST /api/render`, `GET /api/jobs/:id`, `GET /api/download/:job/:file`.
4. **Artifact labels** (GHA → studio): `output.webp` → "Lossless WebP",
   `output.webm` → "HQ WebM (VP9 alpha)", `output.mov` → "ProRes 4444 MOV",
   `output-premul.mov` → "ProRes premul (CapCut)".

## Version pinning

HyperFrames is pinned at `0.7.106` in three places that must move together:
`engine/server.mjs` (`HF_VERSION`), `.github/workflows/render-hq-job.yml`
(`HF_VERSION` env), and the `engine/package.json` doctor script.
