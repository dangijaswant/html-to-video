const editor = document.getElementById("editor");
const preview = document.getElementById("preview");
const exportBtn = document.getElementById("exportBtn");
const statusText = document.getElementById("statusText");
const progressFill = document.getElementById("progressFill");
const downloads = document.getElementById("downloads");
const songNameInput = document.getElementById("songName");
const songDescInput = document.getElementById("songDescInput");

/** Local HQ API (HyperFrames + FFmpeg). On GitHub Pages, point at localhost. */
const API_BASE =
  location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? ""
    : "http://127.0.0.1:8787";

function api(path) {
  return `${API_BASE}${path}`;
}

function selectedFormats() {
  return [...document.querySelectorAll('input[name="fmt"]:checked')].map((el) => el.value);
}

function setStatus(msg, kind = "") {
  statusText.textContent = msg;
  statusText.className = kind;
}

function setProgress(pct) {
  progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function descToHtml(text) {
  return escapeHtml(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("<br />");
}

function htmlToDesc(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function syncSongFieldsFromHtml() {
  const html = editor.value;
  const titleMatch = html.match(/id=["']songTitle["'][^>]*>([\s\S]*?)<\/h1>/i);
  const descMatch = html.match(/id=["']songDesc["'][^>]*>([\s\S]*?)<\/p>/i);
  if (titleMatch) songNameInput.value = titleMatch[1].replace(/<[^>]+>/g, "").trim();
  if (descMatch) songDescInput.value = htmlToDesc(descMatch[1]);
}

function applySongMeta() {
  const title = songNameInput.value.trim() || "Untitled";
  const descHtml = descToHtml(songDescInput.value.trim() || "");
  let html = editor.value;
  if (!/id=["']songTitle["']/i.test(html) || !/id=["']songDesc["']/i.test(html)) {
    setStatus("This template has no songTitle/songDesc fields. Load the music player template.", "error");
    return;
  }
  html = html.replace(
    /(id=["']songTitle["'][^>]*>)([\s\S]*?)(<\/h1>)/i,
    `$1${escapeHtml(title)}$3`
  );
  html = html.replace(
    /(id=["']songDesc["'][^>]*>)([\s\S]*?)(<\/p>)/i,
    `$1${descHtml}$3`
  );
  editor.value = html;
  refreshPreview();
  setStatus(`Song updated: “${title}”.`);
}

/** HyperFrames comps are paused; preview plays (sped up for long timelines). */
function buildPreviewHtml(source, width, height, viewW, viewH) {
  const s = Math.min(viewW / width, viewH / height);
  const bootstrap = `
<style data-studio-preview="1">
  html, body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    background: transparent !important;
    position: relative !important;
  }
  #root {
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    width: ${width}px !important;
    height: ${height}px !important;
    transform: translate(-50%, -50%) scale(${s}) !important;
    transform-origin: center center !important;
    display: grid !important;
    place-items: center !important;
  }
</style>
<script data-studio-preview="1">
(function () {
  function playPreview() {
    if (typeof gsap === "undefined") return false;
    var tls = window.__timelines || {};
    var tl = tls.main || Object.values(tls)[0];
    if (!tl) return false;
    try {
      if (window.__studioPreviewTween) window.__studioPreviewTween.kill();
      tl.pause();
      var dur = tl.duration() || 1;
      if (dur > 12) {
        tl.progress(0);
        tl.timeScale(dur / 10);
        tl.play(0);
        tl.repeat(-1);
      } else {
        var start = 0.22;
        var end = 0.72;
        tl.progress(start);
        window.__studioPreviewTween = gsap.to(tl, {
          progress: end,
          duration: Math.max(1.6, (end - start) * dur),
          ease: "none",
          repeat: -1,
          yoyo: true,
        });
      }
      return true;
    } catch (e) {
      console.error("[studio preview]", e);
      return false;
    }
  }

  function tick(n) {
    if (!playPreview() && n < 60) setTimeout(function () { tick(n + 1); }, 50);
  }

  if (document.readyState === "complete") tick(0);
  else window.addEventListener("load", function () { tick(0); });
  setTimeout(function () { tick(0); }, 0);
})();
</script>`;

  if (/<\/body>/i.test(source)) {
    return source.replace(/<\/body>/i, `${bootstrap}\n</body>`);
  }
  return `${source}\n${bootstrap}`;
}

let previewObjectUrl = null;

function fitPreviewFrame() {
  preview.style.width = "100%";
  preview.style.height = "100%";
  preview.style.minHeight = "400px";
  preview.style.transform = "none";
  preview.style.margin = "0";
  preview.style.border = "0";
  preview.style.background = "transparent";
}

function refreshPreview() {
  const html = editor.value.trim();
  const width = Number(document.getElementById("width").value) || 1920;
  const height = Number(document.getElementById("height").value) || 1080;
  if (!html) {
    preview.removeAttribute("src");
    setStatus("Paste composition HTML to preview.", "error");
    return;
  }
  const wrap = preview.parentElement;
  const viewW = Math.max(wrap?.clientWidth || 800, 80);
  const viewH = Math.max(wrap?.clientHeight || 420, 80);
  const doc = buildPreviewHtml(html, width, height, viewW, viewH);
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = URL.createObjectURL(new Blob([doc], { type: "text/html" }));

  fitPreviewFrame();
  preview.onload = () => fitPreviewFrame();
  preview.src = previewObjectUrl;
}

async function fetchStaticTemplate(name) {
  const res = await fetch(new URL(`../templates/${name}.html`, location.href));
  if (!res.ok) throw new Error(`Template ${name} missing`);
  return res.text();
}

async function loadTemplate(id, { duration } = {}) {
  setStatus(`Loading ${id}…`);
  let html;
  if (!API_BASE) {
    const res = await fetch(api(`/api/template/${id === "music-player" ? "music-player" : id}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load template");
    html = data.html;
  } else {
    try {
      html = await fetchStaticTemplate(id === "aether" ? "aether" : "music-player");
    } catch {
      const path = id === "aether" ? "/api/template/aether" : "/api/template/music-player";
      const res = await fetch(api(path));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load template");
      html = data.html;
    }
  }

  editor.value = html;
  if (typeof duration === "number") {
    document.getElementById("duration").value = String(duration);
  }
  syncSongFieldsFromHtml();
  refreshPreview();
  setStatus(
    API_BASE
      ? `${id} loaded. Export HQ needs local engine on :8787.`
      : `${id} loaded.`
  );
}

async function ensureEngine() {
  try {
    const res = await fetch(api("/api/health"), { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error("Engine unhealthy");
    return true;
  } catch {
    setStatus(
      "HQ engine not reachable at http://127.0.0.1:8787 — clone the repo and run: cd engine && npm run studio",
      "error"
    );
    return false;
  }
}

async function pollJob(id) {
  for (;;) {
    const res = await fetch(api(`/api/jobs/${id}`));
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || "Job poll failed");
    setProgress(job.progress || 0);
    setStatus(`${job.stage} · ${job.progress || 0}%`);
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "Render failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function exportHq() {
  const formats = selectedFormats();
  if (!formats.length) {
    setStatus("Select at least one output format.", "error");
    return;
  }
  // Keep HTML in sync with song fields before export
  if (/id=["']songTitle["']/i.test(editor.value)) applySongMeta();

  exportBtn.disabled = true;
  downloads.innerHTML = "";
  setProgress(2);
  setStatus("Checking local HQ engine…");

  try {
    if (!(await ensureEngine())) return;

    const res = await fetch(api("/api/render"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: editor.value,
        width: Number(document.getElementById("width").value),
        height: Number(document.getElementById("height").value),
        fps: Number(document.getElementById("fps").value),
        duration: Number(document.getElementById("duration").value),
        formats,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Render request failed");

    const job = await pollJob(data.id);
    setProgress(100);
    setStatus(
      `Done${job.frameCount ? ` · ${job.frameCount} frames` : ""}. Download below.`,
      "ok"
    );
    downloads.innerHTML = (job.artifacts || [])
      .map(
        (a) =>
          `<a href="${api(a.url)}" download="${a.name}">${a.label || a.name}</a>`
      )
      .join("");
  } catch (err) {
    setStatus(err.message || String(err), "error");
  } finally {
    exportBtn.disabled = false;
  }
}

document.getElementById("loadMusic").addEventListener("click", () => {
  loadTemplate("music-player", { duration: 180 }).catch((e) => setStatus(e.message, "error"));
});
document.getElementById("loadAether").addEventListener("click", () => {
  loadTemplate("aether", { duration: 5 }).catch((e) => setStatus(e.message, "error"));
});
document.getElementById("applySongMeta").addEventListener("click", applySongMeta);
document.getElementById("refreshPreview").addEventListener("click", () => {
  if (/id=["']songTitle["']/i.test(editor.value)) applySongMeta();
  else refreshPreview();
});
exportBtn.addEventListener("click", exportHq);
editor.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    refreshPreview();
  }
});

["width", "height"].forEach((id) => {
  document.getElementById(id).addEventListener("change", refreshPreview);
});

songNameInput.addEventListener("change", applySongMeta);
songDescInput.addEventListener("change", applySongMeta);

window.addEventListener("resize", () => {
  if (preview.src) refreshPreview();
});

// Default: music player
loadTemplate("music-player", { duration: 180 }).catch(() => {
  setStatus("Could not load music player template.", "error");
});
