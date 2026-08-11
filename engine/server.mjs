import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const STUDIO_DIR = path.join(ROOT, "studio");
const JOBS_DIR = path.join(ROOT, "renders", "jobs");
const PORT = Number(process.env.PORT || 8787);
const HF_VERSION = "0.7.106";

// Windows: refresh PATH from Machine+User (same as encode-hq.ps1) so FFmpeg
// is visible even when the Node process was started without a full login PATH.
if (process.platform === "win32") {
  try {
    const { execSync } = await import("node:child_process");
    const machine = execSync(
      '[Environment]::GetEnvironmentVariable("Path","Machine")',
      { shell: "powershell.exe", encoding: "utf8" }
    ).trim();
    const user = execSync(
      '[Environment]::GetEnvironmentVariable("Path","User")',
      { shell: "powershell.exe", encoding: "utf8" }
    ).trim();
    if (machine || user) process.env.Path = `${machine};${user}`;
  } catch {
    /* keep existing PATH */
  }
}

const jobs = new Map();

await fsp.mkdir(JOBS_DIR, { recursive: true });

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".webm": "video/webm",
      ".webp": "image/webp",
      ".mov": "video/quicktime",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream"
  );
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: {
        ...process.env,
        HYPERFRAMES_SKIP_SKILLS: "1",
        NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192",
      },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      opts.onLog?.(d.toString(), "stdout");
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      opts.onLog?.(d.toString(), "stderr");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}\n${stderr || stdout}`));
    });
  });
}

function patchComposition(html, { width, height, duration, fps }) {
  let out = html;
  const setAttr = (src, name, value) => {
    const re = new RegExp(`(data-${name}=)(["'])(.*?)\\2`, "i");
    if (re.test(src)) return src.replace(re, `$1$2${value}$2`);
    // inject onto root div if present
    return src.replace(
      /(<div[^>]*\bid=["']root["'][^>]*)(>)/i,
      `$1 data-${name}="${value}"$2`
    );
  };
  out = setAttr(out, "width", String(width));
  out = setAttr(out, "height", String(height));
  out = setAttr(out, "duration", String(duration));
  out = setAttr(out, "fps", String(fps));

  // Keep html/body sizing in sync when inline styles use fixed px
  out = out.replace(
    /(meta name=["']viewport["'][^>]*content=["'])[^"']*(["'])/i,
    `$1width=${width}, height=${height}$2`
  );
  out = out.replace(/width:\s*\d+px/g, (m, offset, full) => {
    // only rewrite first few canvas-like occurrences carefully — skip if too broad
    return m;
  });

  // Prefer explicit root canvas sizes when present
  out = out.replace(
    /(html,\s*body\s*\{[^}]*?width:\s*)\d+px/i,
    `$1${width}px`
  );
  out = out.replace(
    /(html,\s*body\s*\{[^}]*?height:\s*)\d+px/i,
    `$1${height}px`
  );
  out = out.replace(/(#root\s*\{[^}]*?width:\s*)\d+px/i, `$1${width}px`);
  out = out.replace(/(#root\s*\{[^}]*?height:\s*)\d+px/i, `$1${height}px`);

  // Also update clip duration attributes that match full composition length (common pattern)
  out = out.replace(
    /(class=["'][^"']*clip[^"']*["'][^>]*data-duration=["'])\d+(\.\d+)?(["'])/gi,
    `$1${duration}$3`
  );

  return out;
}

async function findFramePattern(framesDir) {
  const files = (await fsp.readdir(framesDir))
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();
  if (files.length < 2) throw new Error(`Expected PNG frames, found ${files.length}`);
  const sample = files[0];
  const m = sample.match(/^(.+?)(\d+)(\.png)$/i);
  if (!m) throw new Error(`Unexpected frame name: ${sample}`);
  const digits = m[2].length;
  return {
    count: files.length,
    pattern: path.join(framesDir, `${m[1]}%0${digits}d.png`),
  };
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  jobs.set(id, job);
  return job;
}

async function encodeOutputs(job, framePattern, formats) {
  const { id, fps, dir } = job;
  const outDir = path.join(dir, "out");
  await fsp.mkdir(outDir, { recursive: true });
  const artifacts = [];

  const log = (line) => {
    job.logs.push(line.slice(0, 500));
    if (job.logs.length > 200) job.logs.shift();
  };

  if (formats.includes("webp")) {
    updateJob(id, { stage: "encoding-webp", progress: 55 });
    const dest = path.join(outDir, "output.webp");
    await run(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        framePattern,
        "-c:v",
        "libwebp_anim",
        "-lossless",
        "1",
        "-compression_level",
        "6",
        "-loop",
        "0",
        "-pix_fmt",
        "yuva420p",
        dest,
      ],
      { onLog: (t) => log(t) }
    );
    artifacts.push({ name: "output.webp", path: dest, label: "Lossless WebP" });
  }

  if (formats.includes("webm")) {
    updateJob(id, { stage: "encoding-webm", progress: 70 });
    const dest = path.join(outDir, "output.webm");
    const nullOut = process.platform === "win32" ? "NUL" : "/dev/null";
    await run(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        framePattern,
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "0",
        "-crf",
        "8",
        "-quality",
        "good",
        "-speed",
        "4",
        "-row-mt",
        "1",
        "-tile-columns",
        "2",
        "-pass",
        "1",
        "-an",
        "-f",
        "null",
        nullOut,
      ],
      { cwd: dir, onLog: (t) => log(t) }
    );
    await run(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        framePattern,
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "0",
        "-crf",
        "8",
        "-quality",
        "good",
        "-speed",
        "0",
        "-row-mt",
        "1",
        "-tile-columns",
        "2",
        "-auto-alt-ref",
        "0",
        "-metadata:s:v:0",
        "alpha_mode=1",
        "-pass",
        "2",
        "-an",
        dest,
      ],
      { cwd: dir, onLog: (t) => log(t) }
    );
    artifacts.push({ name: "output.webm", path: dest, label: "HQ WebM (VP9 alpha)" });
  }

  if (formats.includes("mov")) {
    updateJob(id, { stage: "encoding-mov", progress: 88 });
    const dest = path.join(outDir, "output.mov");
    await run(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        framePattern,
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4444",
        "-pix_fmt",
        "yuva444p10le",
        "-vendor",
        "apl0",
        "-color_range",
        "pc",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        dest,
      ],
      { onLog: (t) => log(t) }
    );
    artifacts.push({ name: "output.mov", path: dest, label: "ProRes 4444 MOV" });
  }

  if (formats.includes("mov-premul")) {
    updateJob(id, { stage: "encoding-mov-premul", progress: 93 });
    const dest = path.join(outDir, "output-premul.mov");
    await run(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        framePattern,
        "-vf",
        "format=gbrap16le,premultiply=inplace=1,format=yuva444p10le",
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4444",
        "-vendor",
        "apl0",
        dest,
      ],
      { onLog: (t) => log(t) }
    );
    artifacts.push({
      name: "output-premul.mov",
      path: dest,
      label: "ProRes 4444 premul (CapCut)",
    });
  }

  return artifacts;
}

async function processJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  try {
    updateJob(id, { status: "running", stage: "capturing", progress: 10 });
    const framesDir = path.join(job.dir, "frames");
    await fsp.mkdir(framesDir, { recursive: true });

    await run(
      "npx",
      [
        "--yes",
        `hyperframes@${HF_VERSION}`,
        "render",
        "--composition",
        "composition.html",
        "--format",
        "png-sequence",
        "--fps",
        String(job.fps),
        "--quality",
        "high",
        "--workers",
        "4",
        "--output",
        "frames",
      ],
      {
        cwd: job.dir,
        onLog: (t) => {
          job.logs.push(t.slice(0, 500));
          if (job.logs.length > 200) job.logs.shift();
          // crude progress from "Capturing frame X/Y"
          const m = t.match(/Capturing frame\s+(\d+)\/(\d+)/i);
          if (m) {
            const pct = 10 + Math.floor((Number(m[1]) / Number(m[2])) * 40);
            updateJob(id, { progress: Math.min(pct, 50), stage: "capturing" });
          }
        },
      }
    );

    updateJob(id, { stage: "encoding", progress: 52 });
    const { pattern, count } = await findFramePattern(framesDir);
    job.frameCount = count;
    const artifacts = await encodeOutputs(job, pattern, job.formats);
    updateJob(id, {
      status: "done",
      stage: "done",
      progress: 100,
      artifacts: artifacts.map((a) => ({
        name: a.name,
        label: a.label,
        url: `/api/download/${id}/${a.name}`,
      })),
    });
  } catch (err) {
    updateJob(id, {
      status: "error",
      stage: "error",
      error: err.message || String(err),
      progress: job.progress || 0,
    });
  }
}

async function serveStatic(res, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, engine: "hyperframes+ffmpeg" });
    }

    if (req.method === "GET" && url.pathname === "/api/template/aether") {
      const html = await fsp.readFile(path.join(ROOT, "index.html"), "utf8");
      return sendJson(res, 200, { html, id: "aether" });
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/api/template/music-player" ||
        url.pathname === "/api/template/default")
    ) {
      const html = await fsp.readFile(path.join(ROOT, "music-player.html"), "utf8");
      return sendJson(res, 200, { html, id: "music-player" });
    }

    if (req.method === "POST" && url.pathname === "/api/render") {
      const body = await readBody(req);
      const html = String(body.html || "");
      if (!html.trim()) return sendJson(res, 400, { error: "html is required" });

      const width = Number(body.width || 1920);
      const height = Number(body.height || 1080);
      const fps = Number(body.fps || 30);
      const duration = Number(body.duration || 5);
      let formats = Array.isArray(body.formats) ? body.formats : ["webm"];
      formats = formats.filter((f) =>
        ["webm", "webp", "mov", "mov-premul"].includes(f)
      );
      if (!formats.length) formats = ["webm"];

      const id = randomUUID().slice(0, 8);
      const dir = path.join(JOBS_DIR, id);
      await fsp.mkdir(dir, { recursive: true });
      const patched = patchComposition(html, { width, height, duration, fps });
      const compositionPath = path.join(dir, "composition.html");
      await fsp.writeFile(compositionPath, patched, "utf8");
      // minimal hyperframes project markers
      await fsp.writeFile(
        path.join(dir, "hyperframes.json"),
        await fsp.readFile(path.join(ROOT, "hyperframes.json"), "utf8")
      );
      await fsp.writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify({ id, name: `job-${id}`, createdAt: new Date().toISOString() }, null, 2)
      );
      await fsp.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: `job-${id}`, private: true, type: "module" }, null, 2)
      );

      const job = {
        id,
        status: "queued",
        stage: "queued",
        progress: 0,
        width,
        height,
        fps,
        duration,
        formats,
        dir,
        compositionPath,
        artifacts: [],
        logs: [],
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      jobs.set(id, job);
      setImmediate(() => processJob(id));
      return sendJson(res, 202, { id, status: "queued" });
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return sendJson(res, 404, { error: "Job not found" });
      return sendJson(res, 200, {
        id: job.id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        error: job.error,
        artifacts: job.artifacts,
        frameCount: job.frameCount || null,
        settings: {
          width: job.width,
          height: job.height,
          fps: job.fps,
          duration: job.duration,
          formats: job.formats,
        },
      });
    }

    const dlMatch = url.pathname.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
    if (req.method === "GET" && dlMatch) {
      const [, id, name] = dlMatch;
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, { error: "Job not found" });
      const safe = path.basename(name);
      const filePath = path.join(job.dir, "out", safe);
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: "File not found" });
      res.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Disposition": `attachment; filename="${safe}"`,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Studio static
    let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
    if (reqPath.startsWith("/studio")) reqPath = reqPath.replace(/^\/studio/, "") || "/index.html";
    const filePath = path.normalize(path.join(STUDIO_DIR, reqPath));
    if (!filePath.startsWith(STUDIO_DIR)) return sendJson(res, 403, { error: "Forbidden" });
    return serveStatic(res, filePath);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || String(err) });
  }
});

server.listen(PORT, () => {
  const url = `http://127.0.0.1:${PORT}`;
  const nets = networkInterfaces();
  console.log(`\nHTML → Video Studio`);
  console.log(`  Local:   ${url}`);
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal) {
        console.log(`  Network: http://${n.address}:${PORT}`);
      }
    }
  }
  console.log(`  Engine:  HyperFrames ${HF_VERSION} + FFmpeg (HQ alpha)\n`);

  if (process.env.STUDIO_NO_OPEN !== "1") {
    const openCmd =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    spawn(openCmd[0], openCmd[1], { detached: true, stdio: "ignore" }).unref();
  }
});
