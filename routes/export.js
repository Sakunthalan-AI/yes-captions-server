import fs from "fs";
import path from "path";
import { promisify } from "util";
import { serverExportVideo } from "../lib/serverExportVideo.js";
import { setProgress } from "../lib/progressStore.js";
import multer from "multer";

const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
});

export const uploadMiddleware = upload.single("video");

export async function exportRoute(req, res) {
  let videoPath = null;
  let outputPath = null;

  try {
    const video = req.file;
    const subtitlesStr = req.body.subtitles;
    const globalStyleStr = req.body.globalStyle;
    const exportId = req.body.exportId || Date.now().toString();

    if (!video) {
      return res.status(400).json({ error: "Missing video" });
    }
    if (!subtitlesStr) {
      return res.status(400).json({ error: "Missing subtitles" });
    }
    if (!globalStyleStr) {
      return res.status(400).json({ error: "Missing globalStyle" });
    }

    // Parse JSON data
    const subtitles = JSON.parse(subtitlesStr);
    const globalStyle = JSON.parse(globalStyleStr);

    // Use environment-aware temp directory
    const tmpBase = process.env.VERCEL ? "/tmp" : process.env.RAILWAY_VOLUME_MOUNT_PATH || "/tmp";
    
    // Sanitize filename to avoid filesystem issues
    const sanitizedFileName = video.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');

    // Save video to temporary location
    videoPath = path.join(tmpBase, `input_${Date.now()}_${sanitizedFileName}`);
    fs.writeFileSync(videoPath, video.buffer);

    // Create output path
    outputPath = path.join(tmpBase, `output_${Date.now()}.mp4`);

    // Export video with subtitles
    await serverExportVideo({
      videoPath,
      subtitles,
      globalStyle,
      outputPath,
      onProgress: (progress) => {
        // Update progress store for UI polling
        setProgress(exportId, progress * 100);
        console.log(`Export progress: ${Math.floor(progress * 100)}%`);
      },
    });

    // Read the output video
    const videoBuffer = await readFile(outputPath);
    const filename = `captioned-video-${Date.now()}.mp4`;

    // Cleanup input file immediately
    if (fs.existsSync(videoPath)) await unlink(videoPath);

    // Return file directly as download (server-side)
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', videoBuffer.length.toString());
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(videoBuffer);

    // Cleanup output file after a delay (give time for download to start)
    setTimeout(async () => {
      try {
        if (fs.existsSync(outputPath)) await unlink(outputPath);
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }, 60000); // Clean up after 60 seconds
  } catch (err) {
    console.error("Export error:", err);
    
    // Cleanup on error
    try {
      if (videoPath && fs.existsSync(videoPath)) await unlink(videoPath);
      if (outputPath && fs.existsSync(outputPath)) await unlink(outputPath);
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }

    return res.status(500).json({
      error: "Export failed",
      detail: err.message,
    });
  }
}



