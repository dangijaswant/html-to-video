export interface Env {
  JOBS: KVNamespace;
  CORS_ORIGIN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  RENDER_SECRET?: string;
  MAX_DURATION?: string;
}

type JobStatus = "queued" | "running" | "done" | "error";

interface JobRecord {
  id: string;
  status: JobStatus;
  stage: string;
  progress: number;
  error: string | null;
  html: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  formats: string[];
  artifacts: { name: string; label: string; url: string }[];
  frameCount: number | null;
  createdAt: number;
  updatedAt: number;
}

function cors(origin: string | null, allowed: string) {
  const allow =
    allowed === "*" || !origin
      ? "*"
      : origin === allowed || origin.startsWith(allowed)
        ? origin
        : allowed;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Render-Secret",
    "Access-Control-Expose-Headers": "Content-Disposition,Content-Type",
  };
}

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function withCors(res: Response, request: Request, env: Env) {
  const headers = cors(request.headers.get("Origin"), env.CORS_ORIGIN || "*");
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function publicJob(job: JobRecord) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    artifacts: job.artifacts,
    frameCount: job.frameCount,
    settings: {
      width: job.width,
      height: job.height,
      fps: job.fps,
      duration: job.duration,
      formats: job.formats,
    },
  };
}

async function triggerRender(env: Env, jobId: string) {
  const owner = env.GITHUB_OWNER || "dangijaswant";
  const repo = env.GITHUB_REPO || "html-to-video";
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN secret not configured on Worker");

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "html-to-video-api",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "html-to-video-render",
      client_payload: { job_id: jobId },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch failed (${res.status}): ${text}`);
  }
}

function assertInternal(request: Request, env: Env) {
  const secret = env.RENDER_SECRET;
  if (!secret) return json({ error: "RENDER_SECRET not configured" }, 500);
  const got = request.headers.get("X-Render-Secret") || "";
  if (got !== secret) return json({ error: "Unauthorized" }, 401);
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    try {
      if (url.pathname === "/" || url.pathname === "") {
        return withCors(
          json({
            ok: true,
            service: "html-to-video-api",
            engine: "github-actions+hyperframes+ffmpeg",
            note: "Free tier — HQ renders run on GitHub Actions",
            health: "/api/health",
          }),
          request,
          env
        );
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return withCors(
          json({ ok: true, engine: "github-actions+hyperframes+ffmpeg", free: true }),
          request,
          env
        );
      }

      if (request.method === "POST" && url.pathname === "/api/render") {
        const body = await readJson<{
          html?: string;
          width?: number;
          height?: number;
          fps?: number;
          duration?: number;
          formats?: string[];
        }>(request);

        const html = String(body.html || "");
        if (!html.trim()) return withCors(json({ error: "html is required" }, 400), request, env);
        if (html.length > 1_500_000) {
          return withCors(json({ error: "html too large" }, 400), request, env);
        }

        const maxDur = Number(env.MAX_DURATION || 30);
        let formats = (Array.isArray(body.formats) ? body.formats : ["webm"]).filter((f) =>
          ["webm", "webp", "mov", "mov-premul"].includes(f)
        );
        if (!formats.length) formats = ["webm"];

        const id = crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        const job: JobRecord = {
          id,
          status: "queued",
          stage: "queued",
          progress: 0,
          error: null,
          html,
          width: Number(body.width || 1920),
          height: Number(body.height || 1080),
          fps: Number(body.fps || 30),
          duration: Math.min(Number(body.duration || 5), maxDur),
          formats,
          artifacts: [],
          frameCount: null,
          createdAt: now,
          updatedAt: now,
        };

        await env.JOBS.put(`job:${id}`, JSON.stringify(job), { expirationTtl: 60 * 60 * 48 });
        try {
          await triggerRender(env, id);
        } catch (err) {
          job.status = "error";
          job.stage = "error";
          job.error = err instanceof Error ? err.message : String(err);
          job.updatedAt = Date.now();
          await env.JOBS.put(`job:${id}`, JSON.stringify(job), { expirationTtl: 60 * 60 * 48 });
          return withCors(json({ error: job.error, id }, 500), request, env);
        }

        return withCors(json({ id, status: "queued" }, 202), request, env);
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch) {
        const raw = await env.JOBS.get(`job:${jobMatch[1]}`);
        if (!raw) return withCors(json({ error: "Job not found" }, 404), request, env);
        return withCors(json(publicJob(JSON.parse(raw) as JobRecord)), request, env);
      }

      const htmlMatch = url.pathname.match(/^\/api\/internal\/jobs\/([^/]+)\/html$/);
      if (request.method === "GET" && htmlMatch) {
        const denied = assertInternal(request, env);
        if (denied) return withCors(denied, request, env);
        const raw = await env.JOBS.get(`job:${htmlMatch[1]}`);
        if (!raw) return withCors(json({ error: "Job not found" }, 404), request, env);
        const job = JSON.parse(raw) as JobRecord;
        return withCors(
          json({
            id: job.id,
            html: job.html,
            width: job.width,
            height: job.height,
            fps: job.fps,
            duration: job.duration,
            formats: job.formats,
          }),
          request,
          env
        );
      }

      const statusMatch = url.pathname.match(/^\/api\/internal\/jobs\/([^/]+)\/status$/);
      if (request.method === "POST" && statusMatch) {
        const denied = assertInternal(request, env);
        if (denied) return withCors(denied, request, env);
        const raw = await env.JOBS.get(`job:${statusMatch[1]}`);
        if (!raw) return withCors(json({ error: "Job not found" }, 404), request, env);
        const job = JSON.parse(raw) as JobRecord;
        const body = await readJson<Partial<JobRecord> & { artifacts?: JobRecord["artifacts"] }>(
          request
        );
        if (body.status) job.status = body.status;
        if (body.stage) job.stage = body.stage;
        if (typeof body.progress === "number") job.progress = body.progress;
        if (body.error !== undefined) job.error = body.error;
        if (typeof body.frameCount === "number") job.frameCount = body.frameCount;
        if (Array.isArray(body.artifacts)) job.artifacts = body.artifacts;
        job.updatedAt = Date.now();
        await env.JOBS.put(`job:${job.id}`, JSON.stringify(job), { expirationTtl: 60 * 60 * 48 });
        return withCors(json({ ok: true }), request, env);
      }

      // Internal: register artifact URLs (e.g. GitHub Release assets)
      const artMatch = url.pathname.match(/^\/api\/internal\/jobs\/([^/]+)\/artifacts$/);
      if (request.method === "POST" && artMatch) {
        const denied = assertInternal(request, env);
        if (denied) return withCors(denied, request, env);
        const raw = await env.JOBS.get(`job:${artMatch[1]}`);
        if (!raw) return withCors(json({ error: "Job not found" }, 404), request, env);
        const job = JSON.parse(raw) as JobRecord;
        const body = await readJson<{ artifacts: JobRecord["artifacts"] }>(request);
        job.artifacts = body.artifacts || [];
        job.updatedAt = Date.now();
        await env.JOBS.put(`job:${job.id}`, JSON.stringify(job), { expirationTtl: 60 * 60 * 48 });
        return withCors(json({ ok: true }), request, env);
      }

      return withCors(json({ error: "Not found" }, 404), request, env);
    } catch (err) {
      return withCors(
        json({ error: err instanceof Error ? err.message : String(err) }, 500),
        request,
        env
      );
    }
  },
};
