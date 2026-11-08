# HTML → Transparent Video

Turn HTML/CSS/GSAP into transparent video: **VP9 WebM with alpha**, **lossless animated WebP**, and **ProRes 4444 MOV** (editor masters + a premultiplied variant for CapCut).

```
studio UI ──▶ Cloudflare Worker API ──▶ GitHub Actions render job
   │                              │
   └────────────┬─────────────────┘
                ▼
   HyperFrames captures a lossless PNG sequence ──▶ FFmpeg encodes
                ▼
   Release assets: output.webm · output.webp · output.mov · output-premul.mov
```

- **Live site** — https://dangijaswant.github.io/html-to-video/
- **Studio UI** — https://dangijaswant.github.io/html-to-video/studio/
- **HQ engine (local)** — `engine/`, runs on your machine (Node 22+ and FFmpeg)

## Quick start (local studio)

```bash
git clone https://github.com/dangijaswant/html-to-video.git
cd html-to-video/engine
npm install        # pulls the HyperFrames CLI
npm run doctor     # sanity-checks HyperFrames + FFmpeg
npm run studio     # engine on http://127.0.0.1:8787
```

Then open http://127.0.0.1:8787 — or use the live Studio UI and click **Export HQ**
(it calls localhost when the studio is open there).

## CLI encode (frames → video)

Already captured a PNG sequence? Encode it with the PowerShell helper:

```powershell
cd engine
pwsh ./encode-hq.ps1 -FramesDir renders/frames -Fps 60
# add -SkipCapture to skip the HyperFrames step
```

Requires `ffmpeg` and `ffprobe` on `PATH`.

## Engine API

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/template/aether` · `/api/template/music-player` · `/api/template/default` | sample compositions |
| `POST /api/render` | submit `{ html, duration, fps, width, height, formats[] }` → local render job |
| `GET /api/jobs/:id` | poll job status + artifact list |
| `GET /api/download/:jobId/:file` | download a rendered artifact |

## Repo layout

| Path | What it is |
|---|---|
| `studio/` | static UI served from GitHub Pages |
| `cf-api/` | Cloudflare Worker: job queue (KV) + API, triggers GHA render jobs |
| `cf-engine/` | Cloudflare Worker wrapping the engine in a Container (paid tier) |
| `engine/` | Node + HyperFrames + FFmpeg engine (also runs on Railway/Fly locally) |
| `scripts/patch-job-composition.mjs` | normalizes arbitrary HTML into a renderable HyperFrames composition |
| `scripts/tests/` | dependency-free test suite for the patcher (`npm test`) |
| `templates/` | sample compositions (music player, aether) |
| `docs/ARCHITECTURE.md` | end-to-end data flow + version-pinning rules |
| `.github/workflows/render-hq-job.yml` | GHA HQ render job (free-tier path) |

## Testing

```bash
npm test
# or: node scripts/tests/patch-job-composition.test.mjs
```

The patcher is the seam between arbitrary HTML and the HyperFrames capture — if you
change it, add a fixture under `scripts/tests/fixtures/`.

## Deploy

- **Studio (free):** GitHub Pages (`.github/workflows/deploy-pages.yml`).
- **HQ rendering (free):** the GHA `render-hq-job` triggered by the Worker.
- **Engine (paid):** `cd cf-engine && wrangler deploy` (Cloudflare Containers).

HyperFrames is pinned at `0.7.106` in `engine/server.mjs`, the GHA workflow, and the
doctor script — bump all three together (see `docs/ARCHITECTURE.md`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues: label the repo with
`good first issue` when you add one. Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).
