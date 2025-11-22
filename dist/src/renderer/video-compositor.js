import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
const execAsync = promisify(exec);
const ffmpegPath = ffmpegInstaller.path;
/**
 * Compose final video by overlaying captions onto video frames using FFmpeg
 * This is the final step in the optimized pipeline
 */
export async function composeFinalVideo(options) {
    const { videoFramesDir, overlayFramesDir, audioPath, outputPath, fps, totalFrames, onProgress } = options;
    console.log("Starting optimized FFmpeg video composition...");
    console.log(`- Video frames: ${videoFramesDir}`);
    console.log(`- Overlay frames: ${overlayFramesDir}`);
    console.log(`- Audio source: ${audioPath}`);
    console.log(`- Output: ${outputPath}`);
    console.log(`- FPS: ${fps}, Total frames: ${totalFrames}`);
    // FFmpeg filter_complex to overlay captions onto video frames
    // We use two image sequences as inputs and overlay them
    const ffmpegCommand = [
        `"${ffmpegPath}"`,
        "-framerate", String(fps),
        "-start_number", "1",
        "-i", `"${path.join(videoFramesDir, "video-frame-%06d.jpg")}"`, // Video frames
        "-framerate", String(fps),
        "-start_number", "0",
        "-i", `"${path.join(overlayFramesDir, "overlay-%06d.png")}"`, // Overlay frames
        "-i", `"${audioPath}"`, // Original video for audio
        "-filter_complex", '"[0:v][1:v]overlay=0:0"', // Overlay captions on video
        "-map", "0:v", // Use video from first input (after overlay)
        "-map", "2:a:0?", // Use audio from third input (original video)
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest", // Stop at shortest stream
        "-y", // Overwrite output
        `"${outputPath}"`
    ].join(" ");
    console.log(`FFmpeg command: ${ffmpegCommand}`);
    const startTime = Date.now();
    // Execute FFmpeg with progress tracking
    const ffmpegProcess = exec(ffmpegCommand, { maxBuffer: 50 * 1024 * 1024 });
    let lastProgress = 0;
    let lastReportedProgress = 0;
    ffmpegProcess.stderr?.on("data", (data) => {
        const output = data.toString();
        // Parse FFmpeg progress (frame=XXX)
        const frameMatch = output.match(/frame=\s*(\d+)/);
        if (frameMatch) {
            const currentFrame = parseInt(frameMatch[1]);
            const progress = Math.floor((currentFrame / totalFrames) * 100);
            const normalizedProgress = Math.min(currentFrame / totalFrames, 1);
            if (progress > lastProgress && progress % 5 === 0) {
                console.log(`FFmpeg composition progress: ${progress}%`);
                lastProgress = progress;
            }
            // Call progress callback every 5% or on completion
            if (onProgress && (progress >= lastReportedProgress + 5 || normalizedProgress >= 1)) {
                onProgress(normalizedProgress);
                lastReportedProgress = progress;
            }
        }
    });
    await new Promise((resolve, reject) => {
        ffmpegProcess.on("close", (code) => {
            if (code === 0) {
                // Ensure we report 100% completion
                if (onProgress) {
                    onProgress(1);
                }
                resolve(undefined);
            }
            else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });
        ffmpegProcess.on("error", reject);
    });
    const compositionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Video composition complete in ${compositionTime}s`);
}
