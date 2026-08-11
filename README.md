# HTML → Transparent Video

Live site: https://dangijaswant.github.io/html-to-video/

- **Demo** — sample VP9 alpha WebM
- **[Studio UI](https://dangijaswant.github.io/html-to-video/studio/)** — edit HTML + live preview
- **HQ engine** — HyperFrames + FFmpeg on your machine (`engine/`)

## Quick start (same-quality export)

```bash
git clone https://github.com/dangijaswant/html-to-video.git
cd html-to-video/engine
npm run studio
```

Requirements: Node 22+, FFmpeg on `PATH`.

Then open http://127.0.0.1:8787 or use the live studio page (it calls localhost for Export HQ).

## CLI

```bash
cd engine
npm run encode:hq
```
