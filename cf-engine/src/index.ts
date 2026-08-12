import { Container, getContainer } from "@cloudflare/containers";

/**
 * Durable Object + Cloudflare Container wrapping the HyperFrames/FFmpeg Node API.
 */
export class EngineContainer extends Container {
  defaultPort = 8787;
  sleepAfter = "15m";
  enableInternet = true;

  envVars = {
    STUDIO_NO_OPEN: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    HOST: "0.0.0.0",
    PORT: "8787",
    CORS_ORIGIN: "*",
    NODE_OPTIONS: "--max-old-space-size=3072",
  };
}

export interface Env {
  ENGINE: DurableObjectNamespace;
  CORS_ORIGIN?: string;
}

function withCors(res: Response, request: Request, allowed: string): Response {
  const origin = request.headers.get("Origin") || "";
  const allow =
    allowed === "*" || !origin
      ? "*"
      : origin === allowed || origin.startsWith(allowed)
        ? origin
        : allowed;

  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", allow);
  out.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  out.headers.set("Access-Control-Allow-Headers", "Content-Type");
  out.headers.set("Access-Control-Expose-Headers", "Content-Disposition,Content-Type");
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowed = env.CORS_ORIGIN || "https://dangijaswant.github.io";

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, allowed);
    }

    if (url.pathname === "/" || url.pathname === "") {
      return withCors(
        Response.json({
          ok: true,
          service: "html-to-video-engine",
          docs: "https://dangijaswant.github.io/html-to-video/",
          health: "/api/health",
        }),
        request,
        allowed
      );
    }

    // All other routes (esp. /api/*) go to the containerized Node engine
    const container = getContainer(env.ENGINE, "primary");
    const res = await container.fetch(request);
    return withCors(res, request, allowed);
  },
};
