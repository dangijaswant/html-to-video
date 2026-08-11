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

/** HyperFrames comps are paused + full-res; inject play + fit-to-iframe for studio preview. */
function buildPreviewHtml(source) {
  const width = Number(document.getElementById("width").value) || 1920;
  const height = Number(document.getElementById("height").value) || 1080;
  const bootstrap = `
<script data-studio-preview="1">
(function () {
  var COMP_W = ${width};
  var COMP_H = ${height};

  function fit() {
    var s = Math.min(window.innerWidth / COMP_W, window.innerHeight / COMP_H);
    if (!isFinite(s) || s <= 0) s = 1;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.transformOrigin = "0 0";
    document.body.style.transform = "scale(" + s + ")";
    document.body.style.width = COMP_W + "px";
    document.body.style.height = COMP_H + "px";
  }

  function playPreview() {
    var tls = window.__timelines || {};
    var tl = tls.main || Object.values(tls)[0];
    if (!tl) return false;
    try {
      tl.repeat(-1);
      tl.restart(true, false);
      tl.play(0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function tick(n) {
    fit();
    if (!playPreview() && n < 40) setTimeout(function () { tick(n + 1); }, 50);
  }

  window.addEventListener("resize", fit);
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

function refreshPreview() {
  const html = editor.value.trim();
  if (!html) {
    preview.removeAttribute("srcdoc");
    setStatus("Paste composition HTML to preview.", "error");
    return;
  }
  preview.srcdoc = buildPreviewHtml(html);
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

  // Pages / remote host: static template, export still hits localhost engine
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
