# Quick Start Guide

## For Deployment

### 1. Copy Server Directory
Copy the entire `server/` directory to your deployment location.

### 2. Install Dependencies
```bash
cd server
npm install
```

### 3. Set Environment Variables
Create `.env` file or set in your platform:
```bash
EXPORT_SERVER_PORT=3001
CLIENT_URL=https://your-frontend-domain.com
```

### 4. Start Server
```bash
npm start
```

## Files Structure

```
server/
├── package.json          # Dependencies (REQUIRED)
├── index.js              # Server entry point (REQUIRED)
├── routes/               # API routes (REQUIRED)
│   ├── export.js
│   └── progress.js
├── lib/                  # Core logic (REQUIRED)
│   ├── serverExportVideo.js
│   ├── serverRenderFrame.js
│   ├── getVisibleSubtitles.js
│   └── progressStore.js
├── Dockerfile            # Docker config (optional)
├── Procfile              # Heroku/Render config (optional)
├── .gitignore            # Git ignore (recommended)
├── .dockerignore         # Docker ignore (optional)
└── README.md             # Documentation (recommended)
```

## Minimum Required Files

For basic deployment, you need:
1. `package.json`
2. `index.js`
3. `routes/` directory with all route files
4. `lib/` directory with all library files

Everything else is optional but recommended.

## Testing Locally

```bash
# Install
npm install

# Start
npm start

# Test health
curl http://localhost:3001/health
```

## Common Platforms

### Railway / Render / Heroku
- Just push the `server/` directory
- Set environment variables in platform dashboard
- Platform will run `npm install` and `npm start`

### Docker
```bash
docker build -t captions-server .
docker run -p 3001:3001 -e CLIENT_URL=... captions-server
```

### VPS
```bash
# Install Node.js and FFmpeg
sudo apt-get install nodejs npm ffmpeg

# Install dependencies
npm install

# Start with PM2
npm install -g pm2
pm2 start index.js --name captions-server
```

