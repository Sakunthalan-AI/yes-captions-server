import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { promisify } from "util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { createCanvas } from "@napi-rs/canvas";
import { renderFrame } from "./serverRenderFrame.js";

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

/**
 * Server-side video export with subtitles
 */
export async function serverExportVideo({
  videoPath,
  subtitles,
  globalStyle,
  outputPath,
  onProgress,
}) {
  const frameRate = 30;
  const width = 1080;
  const height = 1920;
  
  // Use environment-aware temp directory (same logic as API route)
  const tmpBase = process.env.VERCEL ? "/tmp" : process.env.RAILWAY_VOLUME_MOUNT_PATH || "/tmp";
  
  // Create temporary directories
  const tmpDir = path.join(tmpBase, `export_${Date.now()}`);
  const framesDir = path.join(tmpDir, "frames");
  const renderedFramesDir = path.join(tmpDir, "rendered_frames");
  const audioPath = path.join(tmpDir, "audio.aac");
  
  await mkdir(framesDir, { recursive: true });
  await mkdir(renderedFramesDir, { recursive: true });

  try {
    // Get video metadata (duration and frame rate)
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const duration = metadata.format.duration;
    
    // Get actual frame rate from video stream (prefer video stream over format)
    let actualFrameRate = frameRate; // Default to 30fps
    if (metadata.streams && metadata.streams.length > 0) {
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (videoStream && videoStream.r_frame_rate) {
        // Parse frame rate (e.g., "30/1" or "29970/1000")
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (den && den > 0) {
          actualFrameRate = num / den;
        } else if (videoStream.avg_frame_rate) {
          const [num2, den2] = videoStream.avg_frame_rate.split('/').map(Number);
          if (den2 && den2 > 0) {
            actualFrameRate = num2 / den2;
          }
        }
      }
    }
    
    // Keep the exact frame rate (don't round) for better accuracy
    // Only round if it's very close to a standard rate
    if (actualFrameRate >= 29.9 && actualFrameRate <= 30.1) {
      actualFrameRate = 30;
    } else if (actualFrameRate >= 23.9 && actualFrameRate <= 24.1) {
      actualFrameRate = 24;
    } else if (actualFrameRate >= 24.9 && actualFrameRate <= 25.1) {
      actualFrameRate = 25;
    } else if (actualFrameRate >= 59.9 && actualFrameRate <= 60.1) {
      actualFrameRate = 60;
    }
    // Otherwise keep the exact detected frame rate

    // Get actual number of frames from video stream if available
    let totalFrames = Math.round(duration * actualFrameRate);
    if (metadata.streams && metadata.streams.length > 0) {
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (videoStream && videoStream.nb_frames) {
        // Use actual frame count from video if available
        totalFrames = parseInt(videoStream.nb_frames) || totalFrames;
      }
    }

    // Extract audio with exact timing preservation
    // Try to copy audio first to preserve original timing, then fallback to re-encoding
    // console.log("Extracting audio...");
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          "-vn", // No video
          "-acodec", "copy", // Try to copy audio codec first (preserves timing exactly)
          "-avoid_negative_ts", "make_zero", // Handle negative timestamps
          "-fflags", "+genpts" // Generate presentation timestamps
        ])
        .output(audioPath)
        .on("end", resolve)
        .on("error", (err) => {
          // If copy fails, fallback to re-encoding with timing preservation
          ffmpeg(videoPath)
            .outputOptions([
              "-vn",
              "-acodec", "aac",
              "-ar", "48000", // Higher sample rate for better quality
              "-ac", "2", // Stereo
              "-b:a", "192k", // Higher bitrate
              "-avoid_negative_ts", "make_zero",
              "-fflags", "+genpts" // Generate presentation timestamps
            ])
            .output(audioPath)
            .on("end", resolve)
            .on("error", reject)
            .run();
        })
        .run();
    });

    // Extract frames at the detected frame rate to match original video timing
    // Using fps filter ensures consistent frame extraction matching the original
    // console.log("Extracting frames...");
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          // Extract frames at the exact detected frame rate
          // This ensures frame timing matches the original video
          "-vf", `fps=${actualFrameRate},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
          "-q:v", "2", // Higher quality (lower number) for better frame accuracy
          "-start_number", "1" // Start frame numbering at 1
        ])
        .output(path.join(framesDir, "frame%05d.png"))
        .on("end", resolve)
        .on("error", reject)
        .on("progress", (progress) => {
          if (onProgress) {
            onProgress(0.1 + (progress.percent || 0) * 0.3 / 100); // 10-40% for frame extraction
          }
        })
        .run();
    });

    // Render frames with subtitles (parallelized for speed)
    // console.log("Rendering frames with subtitles...");
    const CONCURRENT_FRAMES = 8; // Process 8 frames in parallel (increased for faster processing)
    const framePromises = [];
    
    // Get actual number of frames extracted (may differ from calculated)
    const extractedFrames = fs.existsSync(framesDir) 
      ? fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).length 
      : totalFrames;
    
    const actualTotalFrames = Math.min(totalFrames, extractedFrames);
    
    for (let i = 0; i < actualTotalFrames; i++) {
      const frameIndex = i; // Capture i in closure
      // Calculate time more accurately - use frame index / frame rate
      const t = frameIndex / actualFrameRate;
      const framePath = path.join(framesDir, `frame${String(frameIndex + 1).padStart(5, "0")}.png`);
      const renderedFramePath = path.join(renderedFramesDir, `frame${String(frameIndex + 1).padStart(5, "0")}.png`);

      const processFrame = async () => {
        // Check if frame exists
        if (!fs.existsSync(framePath)) {
          // If frame doesn't exist, copy the last available frame
          const lastFrame = frameIndex > 0 ? path.join(renderedFramesDir, `frame${String(frameIndex).padStart(5, "0")}.png`) : framePath;
          if (fs.existsSync(lastFrame)) {
            fs.copyFileSync(lastFrame, renderedFramePath);
          } else {
            // Create a black frame
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, width, height);
            const buffer = canvas.toBuffer("image/png");
            fs.writeFileSync(renderedFramePath, buffer);
          }
          return;
        }

        await renderFrame({
          frameImagePath: framePath,
          subtitles,
          currentTime: t,
          style: globalStyle,
          width,
          height,
          outputPath: renderedFramePath,
        });
      };

      framePromises.push(processFrame());

      // Process frames in batches
      if (framePromises.length >= CONCURRENT_FRAMES || frameIndex === actualTotalFrames - 1) {
        await Promise.all(framePromises);
        framePromises.length = 0; // Clear array
        
        if (onProgress) {
          onProgress(0.4 + (frameIndex / actualTotalFrames) * 0.5); // 40-90% for rendering
        }
      }
    }

    // Combine frames with audio (preserve original video timing)
    // Use passthrough vsync to maintain original frame timing structure
    // console.log("Combining frames and audio...");
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(renderedFramesDir, "frame%05d.png"))
        .inputOptions([
          "-framerate", String(actualFrameRate),
          "-start_number", "1" // Match the frame numbering
        ])
        .input(audioPath)
        .outputOptions([
          "-c:v", "libx264",
          "-preset", "medium", // Use medium preset for better quality and smoothness
          "-crf", "20", // Better quality (lower = better, 20 is high quality)
          "-r", String(actualFrameRate), // Set output frame rate explicitly
          "-g", String(Math.round(actualFrameRate * 2)), // GOP size (2 seconds) for better seeking
          "-keyint_min", String(Math.round(actualFrameRate)), // Minimum keyframe interval
          "-sc_threshold", "0", // Disable scene change detection for constant quality
          "-threads", "0", // Use all available CPU threads
          "-pix_fmt", "yuv420p", // Ensure compatibility
          "-c:a", "aac",
          "-b:a", "192k", // Higher audio bitrate for better quality
          "-ar", "48000", // Higher sample rate
          "-ac", "2", // Stereo
          "-shortest", // End when shortest input ends
          "-vsync", "cfr", // Constant frame rate - ensures smooth playback at exact frame rate
          "-async", "1", // Audio sync method (1 = resample audio to match video)
          "-avoid_negative_ts", "make_zero", // Handle timing issues
          "-fflags", "+genpts", // Generate presentation timestamps for better sync
          "-t", String(duration) // Explicitly set output duration to match input
        ])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .on("progress", (progress) => {
          if (onProgress) {
            onProgress(0.9 + (progress.percent || 0) * 0.1 / 100); // 90-100% for encoding
          }
        })
        .run();
    });

    // console.log("Export completed!");
    if (onProgress) {
      onProgress(1.0);
    }

    // Cleanup temporary files
    const cleanup = async () => {
      try {
        if (fs.existsSync(audioPath)) await unlink(audioPath);
        if (fs.existsSync(framesDir)) {
          const files = fs.readdirSync(framesDir);
          for (const file of files) {
            await unlink(path.join(framesDir, file));
          }
          fs.rmdirSync(framesDir);
        }
        if (fs.existsSync(renderedFramesDir)) {
          const files = fs.readdirSync(renderedFramesDir);
          for (const file of files) {
            await unlink(path.join(renderedFramesDir, file));
          }
          fs.rmdirSync(renderedFramesDir);
        }
        if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    };

    // Don't await cleanup - do it in background
    cleanup().catch(console.error);

    return outputPath;
  } catch (error) {
    // Cleanup on error
    try {
      if (fs.existsSync(audioPath)) await unlink(audioPath);
      if (fs.existsSync(framesDir)) {
        const files = fs.readdirSync(framesDir);
        for (const file of files) {
          await unlink(path.join(framesDir, file));
        }
        fs.rmdirSync(framesDir);
      }
      if (fs.existsSync(renderedFramesDir)) {
        const files = fs.readdirSync(renderedFramesDir);
        for (const file of files) {
          await unlink(path.join(renderedFramesDir, file));
        }
        fs.rmdirSync(renderedFramesDir);
      }
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }
    throw error;
  }
}

