# Captions Export Server

Standalone Node.js server for video export with subtitle rendering.

## Features

- Video export with burned-in subtitles
- Word-by-word subtitle animations
- Real-time progress tracking
- FFmpeg-based video processing
- Canvas-based frame rendering

## Requirements

- Node.js >= 18.0.0
- FFmpeg (installed system-wide or via package)
- npm >= 9.0.0

## Installation

```bash
# Install dependencies
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Environment Variables

- `EXPORT_SERVER_PORT` - Server port (default: 3001)
- `CLIENT_URL` - Frontend URL for CORS (default: http://localhost:3000)
- `RAILWAY_VOLUME_MOUNT_PATH` - Temp directory path for Railway (optional)
- `VERCEL` - Set to `true` if deploying on Vercel (optional)

## Running Locally

```bash
npm start
# or
npm run dev
```

Server will start on `http://localhost:3001`

## API Endpoints

### POST /export
Export video with subtitles.

**Request:**
- `video` (multipart/form-data): Video file
- `subtitles` (string): JSON array of subtitle objects
- `globalStyle` (string): JSON object with global styling
- `exportId` (string, optional): Export ID for progress tracking

**Response:**
- Video file (MP4) as binary download

### GET /export/progress
Get export progress.

**Query Parameters:**
- `exportId` (string): Export ID

**Response:**
```json
{
  "progress": 75.5
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "video-export-server"
}
```

## Docker Deployment

### Build Image

```bash
docker build -t captions-export-server .
```

### Run Container

```bash
docker run -p 3001:3001 \
  -e CLIENT_URL=https://your-frontend.com \
  -e EXPORT_SERVER_PORT=3001 \
  captions-export-server
```

## Platform-Specific Deployment

### Railway

1. Connect your repository
2. Set environment variables:
   - `CLIENT_URL`: Your frontend URL
   - `RAILWAY_VOLUME_MOUNT_PATH`: `/tmp` (if using volume)
3. Deploy

### Render

1. Create new Web Service
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Set environment variables:
   - `CLIENT_URL`: Your frontend URL
   - `EXPORT_SERVER_PORT`: `3001`

### Heroku

1. Create `Procfile`:
   ```
   web: node index.js
   ```
2. Set environment variables
3. Deploy

### DigitalOcean App Platform

1. Create new app from GitHub
2. Set build command: `npm install`
3. Set run command: `npm start`
4. Set environment variables

### AWS EC2 / VPS

1. Install Node.js and FFmpeg:
   ```bash
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install -y nodejs npm ffmpeg
   ```
2. Clone repository
3. Install dependencies: `npm install`
4. Set environment variables
5. Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start index.js --name captions-server
   pm2 save
   pm2 startup
   ```

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `EXPORT_SERVER_PORT` | Server port | `3001` | No |
| `CLIENT_URL` | Frontend URL for CORS | `http://localhost:3000` | No |
| `RAILWAY_VOLUME_MOUNT_PATH` | Temp directory (Railway) | `/tmp` | No |
| `VERCEL` | Vercel deployment flag | `false` | No |

## Troubleshooting

### FFmpeg not found
Ensure FFmpeg is installed system-wide or use the Docker image which includes it.

### CORS errors
Add your frontend URL to `CLIENT_URL` environment variable.

### Out of memory
- Reduce video file size limit in `routes/export.js`
- Increase server memory allocation
- Process videos in smaller chunks

### Port already in use
Change `EXPORT_SERVER_PORT` to an available port.

## License

ISC

