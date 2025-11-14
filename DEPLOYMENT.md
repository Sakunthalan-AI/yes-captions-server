# Deployment Checklist

## Files Required for Deployment

### Essential Files
- ✅ `package.json` - Dependencies and scripts
- ✅ `index.js` - Server entry point
- ✅ `routes/` - API routes
- ✅ `lib/` - Core logic files

### Configuration Files
- ✅ `.gitignore` - Git ignore rules
- ✅ `.dockerignore` - Docker ignore rules (if using Docker)
- ✅ `Dockerfile` - Docker configuration (if using Docker)
- ✅ `Procfile` - Heroku/Render configuration
- ✅ `README.md` - Documentation

### Optional Files
- `.env` - Environment variables (create from `.env.example`)
- `ecosystem.config.js` - PM2 configuration (for VPS)

## Pre-Deployment Steps

1. **Test locally:**
   ```bash
   cd server
   npm install
   npm start
   ```

2. **Set environment variables:**
   - `EXPORT_SERVER_PORT` (default: 3001)
   - `CLIENT_URL` (your frontend URL)

3. **Verify FFmpeg:**
   - Docker: Included in Dockerfile
   - VPS: Install system-wide
   - Cloud platforms: Check platform docs

## Platform-Specific Notes

### Railway
- Uses `RAILWAY_VOLUME_MOUNT_PATH` for temp files
- Set `CLIENT_URL` to your frontend URL

### Render
- Set build command: `npm install`
- Set start command: `npm start`
- Set `CLIENT_URL` environment variable

### Heroku
- Uses `Procfile` for process definition
- May need buildpack for FFmpeg

### Docker
- Build: `docker build -t captions-server .`
- Run: `docker run -p 3001:3001 -e CLIENT_URL=... captions-server`

### VPS/EC2
- Install Node.js 18+
- Install FFmpeg: `apt-get install ffmpeg`
- Use PM2 for process management

## Post-Deployment

1. Test health endpoint: `GET /health`
2. Test export endpoint with a small video
3. Monitor logs for errors
4. Check CORS configuration matches frontend URL

