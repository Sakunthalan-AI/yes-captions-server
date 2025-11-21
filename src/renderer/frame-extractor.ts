import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execAsync = promisify(exec);

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
    fps: number = 30
): Promise<FrameExtractionResult> {
    console.log(`Extracting frames from video at ${fps} FPS...`);
    console.log(`Video: ${videoPath}`);
    console.log(`Output: ${outputDir}`);

    // First, get video metadata (duration)
    const probeCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const { stdout: durationOutput } = await execAsync(probeCommand);
    const duration = parseFloat(durationOutput.trim());
    const totalFrames = Math.ceil(duration * fps);

    console.log(`Video duration: ${duration}s, Total frames: ${totalFrames}`);

    // Extract frames using FFmpeg
    // %06d creates zero-padded filenames: frame-000000.jpg, frame-000001.jpg, etc.
    const outputPattern = path.join(outputDir, "video-frame-%06d.jpg");

    const extractCommand = [
        "ffmpeg",
        "-i", `"${videoPath}"`,
        "-vf", `fps=${fps}`, // Extract at specified FPS
        "-q:v", "2", // High quality JPEG (2 = best quality)
        "-start_number", "0", // Start numbering from 0
        `"${outputPattern}"`
    ].join(" ");

    console.log(`Running FFmpeg extraction: ${extractCommand}`);

    const startTime = Date.now();
    await execAsync(extractCommand, { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer
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
