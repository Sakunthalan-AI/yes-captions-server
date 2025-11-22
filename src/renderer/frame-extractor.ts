import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execAsync = promisify(exec);
const ffmpegPath = ffmpegInstaller.path;
const ffprobePath = ffprobeInstaller.path;

export interface FrameExtractionResult {
    framePaths: string[];
    totalFrames: number;
    duration: number;
    fps: number;
}

/**
 * Extract all frames from a video using FFmpeg (hardware-accelerated when possible)
 * This is MUCH faster than seeking in a browser
 */
export async function extractVideoFrames(
    videoPath: string,
    outputDir: string,
    fps: number = 30,
    onProgress?: (progress: number) => void
): Promise<FrameExtractionResult> {
    console.log(`Extracting frames from video at ${fps} FPS...`);
    console.log(`Video: ${videoPath}`);
    console.log(`Output: ${outputDir}`);

    // First, get video metadata (duration)
    const probeCommand = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const { stdout: durationOutput } = await execAsync(probeCommand);
    const duration = parseFloat(durationOutput.trim());
    const totalFrames = Math.ceil(duration * fps);

    console.log(`Video duration: ${duration}s, Total frames: ${totalFrames}`);

    // Extract frames using FFmpeg
    // %06d creates zero-padded filenames: frame-000000.jpg, frame-000001.jpg, etc.
    const outputPattern = path.join(outputDir, "video-frame-%06d.jpg");

    const extractCommand = [
        `"${ffmpegPath}"`,
        "-i", `"${videoPath}"`,
        "-vf", `fps=${fps}`, // Extract at specified FPS
        "-q:v", "2", // High quality JPEG (2 = best quality)
        "-start_number", "0", // Start numbering from 0
        `"${outputPattern}"`
    ].join(" ");

    console.log(`Running FFmpeg extraction: ${extractCommand}`);

    const startTime = Date.now();
    
    // Use exec with streaming to track progress
    if (onProgress) {
        const ffmpegProcess = exec(extractCommand, { maxBuffer: 50 * 1024 * 1024 });
        let lastProgress = 0;

        ffmpegProcess.stderr?.on("data", (data: Buffer) => {
            const output = data.toString();
            
            // Parse FFmpeg frame output (frame=XXX)
            const frameMatch = output.match(/frame=\s*(\d+)/);
            if (frameMatch) {
                const currentFrame = parseInt(frameMatch[1]);
                const progress = Math.min(currentFrame / totalFrames, 1);
                
                // Only report progress every 5% to avoid too many updates
                const progressPercent = Math.floor(progress * 100);
                if (progressPercent > lastProgress && progressPercent % 5 === 0) {
                    onProgress(progress);
                    lastProgress = progressPercent;
                }
            }
        });

        await new Promise<void>((resolve, reject) => {
            ffmpegProcess.on("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg frame extraction exited with code ${code}`));
                }
            });
            ffmpegProcess.on("error", reject);
        });

        // Ensure we report 100% completion
        onProgress(1);
    } else {
        await execAsync(extractCommand, { maxBuffer: 50 * 1024 * 1024 });
    }

    const extractionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Frame extraction complete in ${extractionTime}s`);

    // Generate frame paths
    const framePaths: string[] = [];
    for (let i = 0; i < totalFrames; i++) {
        framePaths.push(path.join(outputDir, `video-frame-${String(i + 1).padStart(6, "0")}.jpg`));
    }

    return {
        framePaths,
        totalFrames,
        duration,
        fps
    };
}
