# HTML → Video HQ engine (HyperFrames + FFmpeg + Chrome)
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    HYPERFRAMES_SKIP_SKILLS=1 \
    STUDIO_NO_OPEN=1 \
    PUPPETEER_SKIP_DOWNLOAD=false \
    NODE_OPTIONS=--max-old-space-size=4096

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
# Prefetch HyperFrames + Chrome headless shell used by the renderer
RUN npx --yes hyperframes@0.7.106 browser --install || npx --yes puppeteer browsers install chrome-headless-shell || true

COPY . .

# Persist job outputs on an ephemeral volume when provided
RUN mkdir -p /app/renders/jobs && chown -R node:node /app

USER node
EXPOSE 8787
ENV PORT=8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
