import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdir, rm } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrowser, renderCaptionOverlays } from "./src/renderer/overlay-renderer.js";
import { extractVideoFrames } from "./src/renderer/frame-extractor.js";
import { composeFinalVideo } from "./src/renderer/video-compositor.js";
import { setProgress, subscribe } from "./lib/progressStore.js";
const fastify = Fastify({
    logger: {
        transport: process.env.NODE_ENV === "production"
            ? undefined
            : {
                target: "pino-pretty",
                options: { translateTime: "SYS:standard" },
            },
    },
});
fastify.register(multipart, {
    limits: {
        fileSize: 300 * 1024 * 1024, // 300MB
    },
});
const ensureTempDir = async () => {
    const tempRoot = path.join(os.tmpdir(), "caption-export");
    await mkdir(tempRoot, { recursive: true });
    return await fs.promises.mkdtemp(`${tempRoot}${path.sep}`);
};
const persistStream = async (fileStream, filePath) => {
    await pipeline(fileStream, fs.createWriteStream(filePath));
    return filePath;
};
fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    renderer: "ffmpeg-optimized",
    version: "3.0.0",
}));
// SSE Progress endpoint
fastify.get("/progress/:exportId", async (request, reply) => {
    const { exportId } = request.params;
    // Hijack the connection to maintain control
    reply.hijack();
    // Set SSE headers
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    // Send initial connection confirmation
    try {
        reply.raw.write(`: connected\n\n`);
    }
    catch (error) {
        fastify.log.error({ error, exportId }, "Error writing initial SSE message");
        return;
    }
    // Subscribe to progress updates
    const unsubscribe = subscribe(exportId, (state) => {
        try {
            const data = JSON.stringify({
                progress: state.progress,
                stage: state.stage,
                message: state.message,
            });
            reply.raw.write(`data: ${data}\n\n`);
        }
        catch (error) {
            // Connection likely closed, stop trying to write
            fastify.log.warn({ error, exportId }, "Error sending SSE progress update, connection may be closed");
            unsubscribe();
        }
    });
    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
        try {
            reply.raw.write(`: heartbeat\n\n`);
        }
        catch (error) {
            // Connection closed, stop heartbeat
            clearInterval(heartbeatInterval);
            unsubscribe();
        }
    }, 30000);
    // Handle client disconnect
    request.raw.on("close", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        try {
            reply.raw.end();
        }
        catch (error) {
            // Connection already closed, ignore
        }
    });
});
fastify.post("/render", async (request, reply) => {
    const parts = request.parts();
    const tempDir = await ensureTempDir();
    let payloadString;
    let videoPath;
    let exportId = `job_${Date.now()}`;
    try {
        // Parse multipart form data
        for await (const part of parts) {
            if (part.type === "file" && part.fieldname === "video") {
                const filename = part.filename || "source.mp4";
                videoPath = await persistStream(part.file, path.join(tempDir, filename));
                request.log.info({ videoPath }, "Video file received");
            }
            else if (part.type === "field" && part.fieldname === "payload") {
                payloadString = part.value;
            }
            else if (part.type === "field" && part.fieldname === "exportId") {
                exportId = String(part.value);
            }
        }
        if (!videoPath) {
            reply.status(400);
            return { error: "Video file is required" };
        }
        if (!payloadString) {
            reply.status(400);
            return { error: "Payload is required" };
        }
        const payload = JSON.parse(payloadString);
        if (payload.metadata.exportId !== exportId) {
            request.log.warn({ exportId, payloadExportId: payload.metadata.exportId }, "Export ID mismatch");
            exportId = payload.metadata.exportId;
        }
        request.log.info({
            exportId,
            subtitleCount: payload.subtitles.length,
            fontFamily: payload.style.fontFamily,
            canvas: payload.metadata.canvas,
        }, "Starting optimized render pipeline");
        // Initialize progress
        setProgress(exportId, 0, "initialization", "Starting render pipeline");
        const fps = 30;
        // STEP 1: Extract video frames using FFmpeg (FAST!)
        const videoFramesDir = path.join(tempDir, "video-frames");
        await mkdir(videoFramesDir, { recursive: true });
        request.log.info("Extracting video frames with FFmpeg...");
        setProgress(exportId, 5, "initialization", "Extracting video frames");
        // Progress callback for frame extraction (10-30% range)
        const onFrameExtractionProgress = (progress) => {
            const mappedProgress = 10 + progress * 0.2; // Map 0-1 to 10-30%
            setProgress(exportId, mappedProgress, "video processing", "Extracting frames from video");
        };
        const frameExtractionResult = await extractVideoFrames(videoPath, videoFramesDir, fps, onFrameExtractionProgress);
        request.log.info({
            totalFrames: frameExtractionResult.totalFrames,
            duration: frameExtractionResult.duration,
        }, "Video frames extracted");
        setProgress(exportId, 30, "video processing", "Video frames extracted");
        // STEP 2: Render caption overlays using Puppeteer (SIMPLE!)
        const overlayDir = path.join(tempDir, "overlays");
        await mkdir(overlayDir, { recursive: true });
        request.log.info("Rendering caption overlays...");
        setProgress(exportId, 30, "caption rendering", "Rendering caption overlays");
        const browser = await createBrowser();
        let browserClosed = false;
        try {
            // Progress callback for overlay rendering (30-70% range)
            const onOverlayProgress = (progress) => {
                const mappedProgress = 30 + progress * 0.4; // Map 0-1 to 30-70%
                setProgress(exportId, mappedProgress, "caption rendering", "Rendering caption overlays");
            };
            const overlayResult = await renderCaptionOverlays(browser, payload, frameExtractionResult.totalFrames, frameExtractionResult.duration, fps, overlayDir, onOverlayProgress);
            request.log.info({ totalOverlays: overlayResult.totalFrames }, "Caption overlays rendered");
            setProgress(exportId, 70, "caption rendering", "Caption overlays rendered");
            // Close browser after rendering overlays
            await browser.close();
            browserClosed = true;
            request.log.info("Browser closed after overlay rendering");
            // STEP 3: Composite overlays onto video frames using FFmpeg (FAST!)
            const outputPath = path.join(tempDir, `captioned-${exportId}.mp4`);
            request.log.info("Compositing final video with FFmpeg...");
            setProgress(exportId, 70, "encoding", "Compositing final video");
            // Progress callback for video composition (70-95% range)
            const onCompositionProgress = (progress) => {
                const mappedProgress = 70 + progress * 0.25; // Map 0-1 to 70-95%
                setProgress(exportId, mappedProgress, "encoding", "Compositing video frames");
            };
            await composeFinalVideo({
                videoFramesDir,
                overlayFramesDir: overlayDir,
                audioPath: videoPath,
                outputPath,
                fps,
                totalFrames: frameExtractionResult.totalFrames,
                onProgress: onCompositionProgress,
            });
            request.log.info({ outputPath }, "Video composition complete");
            setProgress(exportId, 95, "finalizing", "Finalizing video");
            // Stream the output file
            reply.header("Content-Type", "video/mp4");
            reply.header("Content-Disposition", `attachment; filename="captioned-${exportId}.mp4"`);
            setProgress(exportId, 100, "complete", "Video export complete");
            return reply.send(fs.createReadStream(outputPath));
        }
        catch (renderError) {
            request.log.error({
                error: renderError instanceof Error ? renderError.message : String(renderError),
                stack: renderError instanceof Error ? renderError.stack : undefined
            }, "Frame capture or composition failed");
            throw renderError;
        }
        finally {
            // Ensure browser is closed even if error occurred
            if (!browserClosed && browser) {
                try {
                    await browser.close();
                    request.log.info("Browser closed after error");
                }
                catch (closeError) {
                    request.log.warn("Failed to close browser after error");
                }
            }
        }
    }
    catch (error) {
        // Force error to console
        console.error("=== RENDER ERROR ===");
        console.error(error);
        console.error("====================");
        request.log.error(error, "Failed to render video");
        // Log detailed error information
        if (error instanceof Error) {
            request.log.error({
                errorMessage: error.message,
                errorStack: error.stack,
                errorName: error.name,
            }, "Detailed error info");
        }
        // Update progress to indicate error
        setProgress(exportId, 100, "error", error instanceof Error ? error.message : "Render failed");
        reply.status(500);
        return {
            error: error instanceof Error ? error.message : "Render failed",
            details: error instanceof Error ? error.stack : undefined,
        };
    }
    finally {
        // Clean up temp directory after a delay
        setTimeout(() => {
            rm(tempDir, { recursive: true, force: true }).catch((err) => {
                fastify.log.warn({ err, tempDir }, "Failed to clean up temp directory");
            });
        }, 5_000);
    }
});
fastify.post("/transcribe", async (request, reply) => {
    const parts = request.parts();
    const tempDir = await ensureTempDir();
    let videoPath;
    let language;
    try {
        for await (const part of parts) {
            if (part.type === "file" && part.fieldname === "video") {
                const filename = part.filename || "source.mp4";
                videoPath = await persistStream(part.file, path.join(tempDir, filename));
            }
            else if (part.type === "field" && part.fieldname === "language") {
                language = String(part.value);
            }
        }
        if (!videoPath) {
            reply.status(400);
            return { error: "Video file is required" };
        }
        // Validate and default language
        const validLanguageCodes = [
            'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ru', 'ur',
            'de', 'ja', 'mr', 'vi', 'te', 'ha', 'tr', 'sw', 'tl', 'ta', 'fa',
            'ko', 'th', 'jv', 'it', 'gu', 'am', 'kn', 'bho', 'pa', 'pcm', 'pl',
            'uk', 'ro'
        ];
        const languageCode = (language && validLanguageCodes.includes(language))
            ? language
            : 'en'; // Fallback to English if invalid or missing
        request.log.info({ language: languageCode, originalLanguage: language }, "Transcribing with language");
        // Import dynamically to avoid circular deps if any, though not expected here
        const { transcribeVideo } = await import("./src/transcription.js");
        const result = await transcribeVideo(videoPath, tempDir, languageCode);
        return result;
    }
    catch (error) {
        request.log.error(error, "Transcription failed");
        reply.status(500);
        return {
            error: error instanceof Error ? error.message : "Transcription failed",
        };
    }
    finally {
        // Clean up temp directory
        setTimeout(() => {
            rm(tempDir, { recursive: true, force: true }).catch((err) => {
                fastify.log.warn({ err, tempDir }, "Failed to clean up temp directory");
            });
        }, 5_000);
    }
});
// Graceful shutdown
process.on("SIGTERM", async () => {
    fastify.log.info("SIGTERM received, shutting down gracefully");
    await fastify.close();
    process.exit(0);
});
process.on("SIGINT", async () => {
    fastify.log.info("SIGINT received, shutting down gracefully");
    await fastify.close();
    process.exit(0);
});
export const startExportWorker = async () => {
    const port = Number(process.env.EXPORT_WORKER_PORT || 3001);
    const host = process.env.EXPORT_WORKER_HOST || "0.0.0.0";
    await fastify.listen({ port, host });
    fastify.log.info(`Export worker (Puppeteer) listening on http://${host}:${port}`);
    return fastify;
};
if (process.env.EXPORT_WORKER_AUTO_START !== "false") {
    startExportWorker().catch((error) => {
        fastify.log.error(error, "Failed to start export worker");
        process.exit(1);
    });
}
