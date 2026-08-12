#!/usr/bin/env node
import fs from "node:fs";

const jobPath = process.argv[2] || "work/job.json";
const outDir = process.argv[3] || "work";

const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
const width = job.width;
const height = job.height;
const duration = job.duration;
const fps = job.fps;
let html = String(job.html || "");

// Bare HTML (no HyperFrames root/clip) → wrap so capture has a finite timeline
if (!/\bid=["']root["']/i.test(html) || !/\bclip\b/i.test(html)) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
  const inner = (bodyMatch ? bodyMatch[1] : html).trim();
  const headExtra = headMatch ? headMatch[1] : "";
  html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=${width}, height=${height}"/>
${headExtra}
<style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}#root{position:relative;width:${width}px;height:${height}px}</style>
</head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}" data-fps="${fps}">
  <div id="main-clip" class="stage clip" data-start="0" data-duration="${duration}" data-track-index="0">${inner}</div>
</div>
</body></html>`;
}

const setAttr = (src, name, value) => {
  const re = new RegExp(`(data-${name}=)(["'])(.*?)\\2`, "i");
  if (re.test(src)) return src.replace(re, `$1$2${value}$2`);
  return src.replace(
    /(<div[^>]*\bid=["']root["'][^>]*)(>)/i,
    `$1 data-${name}="${value}"$2`
  );
};

html = setAttr(html, "width", String(width));
html = setAttr(html, "height", String(height));
html = setAttr(html, "duration", String(duration));
html = setAttr(html, "fps", String(fps));
html = html.replace(
  /(meta name=["']viewport["'][^>]*content=["'])[^"']*(["'])/i,
  `$1width=${width}, height=${height}$2`
);
html = html.replace(/(html,\s*body\s*\{[^}]*?width:\s*)\d+px/i, `$1${width}px`);
html = html.replace(
  /(html,\s*body\s*\{[^}]*?height:\s*)\d+px/i,
  `$1${height}px`
);
html = html.replace(/(#root\s*\{[^}]*?width:\s*)\d+px/i, `$1${width}px`);
html = html.replace(/(#root\s*\{[^}]*?height:\s*)\d+px/i, `$1${height}px`);
html = html.replace(
  /(class=["'][^"']*clip[^"']*["'][^>]*data-duration=["'])\d+(\.\d+)?(["'])/gi,
  `$1${duration}$3`
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/composition.html`, html);
fs.writeFileSync(
  `${outDir}/settings.json`,
  JSON.stringify({
    width,
    height,
    fps,
    duration,
    formats: job.formats,
  })
);
fs.writeFileSync(
  `${outDir}/hyperframes.json`,
  JSON.stringify(
    {
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry:
        "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
      paths: {
        blocks: "compositions",
        components: "compositions/components",
        assets: "assets",
      },
      media: { autoProxy: true },
    },
    null,
    2
  )
);
fs.writeFileSync(
  `${outDir}/meta.json`,
  JSON.stringify(
    {
      id: job.id,
      name: `job-${job.id}`,
      createdAt: new Date().toISOString(),
    },
    null,
    2
  )
);
fs.writeFileSync(
  `${outDir}/package.json`,
  JSON.stringify({ name: `job-${job.id}`, private: true, type: "module" })
);

console.log(
  job.id,
  job.formats,
  `${duration}s`,
  `${fps}fps`,
  `bytes=${html.length}`
);
