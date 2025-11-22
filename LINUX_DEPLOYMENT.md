## Linux Deployment Guide (with PM2)

This guide assumes:
- You have a Linux server (e.g. Ubuntu/Debian).
- Node.js **>= 18** and npm are installed.
- `pm2` is installed globally (`npm install -g pm2`).
- You will clone this repository on the server.

---

### 1. Install system dependencies

On Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
  ffmpeg \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  build-essential \
  python3 \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2 \
  libatspi2.0-0 \
  libxshmfence1 \
  libcups2 \
  libx11-xcb1 \
  libxcursor1 \
  libxi6 \
  libxtst6 \
  libatk1.0-0 \
  libpangocairo-1.0-0 \
  libgtk-3-0
```

These packages provide FFmpeg and the libraries Chromium (used by Puppeteer) needs to run headless for rendering.

---

### 2. Clone the repository

```bash
cd /path/where/you/want/the/server
git clone <YOUR_REPO_URL> yes-captions-server
cd yes-captions-server
```

Replace `<YOUR_REPO_URL>` with your actual Git URL.

---

### 3. Install Node dependencies (auto-builds TypeScript)

```bash
npm install
```

The `postinstall` script will automatically run:

```bash
npm run build
```

This compiles the TypeScript source into `dist/` so the server can run with plain Node.js.

---

### 4. Configure environment variables

Create a `.env` file (optional but recommended) or set env vars in your process manager:

```bash
cat > .env << 'EOF'
GROQ_API_KEY=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
EXPORT_WORKER_PORT=3001
EXPORT_WORKER_HOST=0.0.0.0
NODE_ENV=production
EXPORT_WORKER_AUTO_START=true
EOF
```

You can also export them directly in the shell or configure them inside PM2, but `.env` is the simplest for development.

If you use a `.env` file, load it before starting PM2 (for example, with `dotenv-cli` or by exporting vars manually).

---

### 5. Start the server with PM2

Since the compiled entry point is `dist/index.js`, you can start it directly:

```bash
pm2 start dist/index.js --name yes-captions-server
```

Or, if you prefer to let npm handle the start script:

```bash
pm2 start npm --name yes-captions-server -- start
```

Either approach will start the Fastify server on `EXPORT_SERVER_PORT` (default `3001`).

---

### 6. Enable PM2 startup on boot

```bash
pm2 save
pm2 startup
```

Follow the instructions printed by `pm2 startup` to enable the service on boot.

---

### 7. Verify the server is running

From the Linux server:

```bash
curl http://localhost:3001/health
```

You should see a JSON response similar to:

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "renderer": "ffmpeg-optimized",
  "version": "3.0.0"
}
```

From your frontend or another machine, hit:

```text
http://<YOUR_SERVER_IP_OR_DOMAIN>:3001/health
```

Make sure your firewall / security group allows inbound traffic on port `3001` (or the port you configured).

---

### 8. Useful PM2 commands

```bash
pm2 list                       # Show all processes
pm2 logs yes-captions-server   # View logs
pm2 restart yes-captions-server
pm2 stop yes-captions-server
pm2 delete yes-captions-server
```


