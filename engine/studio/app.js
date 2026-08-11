const editor = document.getElementById("editor");
const preview = document.getElementById("preview");
const exportBtn = document.getElementById("exportBtn");
const statusText = document.getElementById("statusText");
const progressFill = document.getElementById("progressFill");
const downloads = document.getElementById("downloads");

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

/** HyperFrames comps are paused; inject loop of the visible mid-section for studio preview. */
function buildPreviewHtml(source) {
  const bootstrap = `
<style data-studio-preview="1">
  html, body { background: transparent !important; overflow: hidden !important; }
</style>
<script data-studio-preview="1">
(function () {
  function playPreview() {
    if (typeof gsap === "undefined") return false;
    var tls = window.__timelines || {};
    var tl = tls.main || Object.values(tls)[0];
    if (!tl) return false;
    try {
      // Avoid the final fade-to-empty: yoyo the visible middle of the sting
      tl.pause();
      var start = 0.22;
      var end = 0.72;
      tl.progress(start);
      if (window.__studioPreviewTween) window.__studioPreviewTween.kill();
      window.__studioPreviewTween = gsap.to(tl, {
        progress: end,
        duration: Math.max(1.6, (end - start) * tl.duration()),
        ease: "none",
        repeat: -1,
        yoyo: true,
      });
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

function fitPreviewFrame(width, height) {
  const wrap = preview.parentElement;
  if (!wrap) return;
  const pad = 0;
  const ww = Math.max(wrap.clientWidth - pad, 80);
  const wh = Math.max(wrap.clientHeight - pad, 80);
  const s = Math.min(ww / width, wh / height);
  preview.style.width = `${width}px`;
  preview.style.height = `${height}px`;
  preview.style.transform = `scale(${s})`;
  preview.style.transformOrigin = "top left";
  preview.style.border = "0";
  preview.style.background = "transparent";
  // Collapse layout to the scaled visual size so the checkerboard fits
  preview.style.marginBottom = `${height * s - height}px`;
  preview.style.marginRight = `${width * s - width}px`;
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
  const doc = buildPreviewHtml(html);
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = URL.createObjectURL(new Blob([doc], { type: "text/html" }));

  preview.onload = () => {
    fitPreviewFrame(width, height);
  };
  preview.src = previewObjectUrl;
}

async function loadAether() {
  setStatus("Loading Aether template…");
  if (!API_BASE) {
    const res = await fetch(api("/api/template/aether"));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load template");
    editor.value = data.html;
    refreshPreview();
    setStatus("Aether template loaded.");
    return;
  }

  try {
    const res = await fetch(new URL("../templates/aether.html", location.href));
    if (!res.ok) throw new Error("Template missing");
    editor.value = await res.text();
    refreshPreview();
    setStatus("Aether template loaded. Export HQ needs local engine on :8787.");
  } catch {
    const res = await fetch(api("/api/template/aether"));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load template");
    editor.value = data.html;
    refreshPreview();
    setStatus("Aether template loaded.");
  }
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

document.getElementById("loadAether").addEventListener("click", () => {
  loadAether().catch((e) => setStatus(e.message, "error"));
});
document.getElementById("refreshPreview").addEventListener("click", refreshPreview);
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

window.addEventListener("resize", () => {
  const width = Number(document.getElementById("width").value) || 1920;
  const height = Number(document.getElementById("height").value) || 1080;
  if (preview.src) fitPreviewFrame(width, height);
});

loadAether().catch(() => {
  editor.value = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin:0; width:1920px; height:1080px; background:transparent; overflow:hidden; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="1920" data-height="1080" data-fps="30"></div>
</body>
</html>`;
  refreshPreview();
  setStatus("Ready. For Export HQ, run the local engine on port 8787.");
});
