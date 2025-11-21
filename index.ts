import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdir, writeFile, rm } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { CaptionExportPayload } from "./src/types.js";
import { createBrowser, renderCaptionOverlays } from "./src/renderer/overlay-renderer.js";
import { extractVideoFrames } from "./src/renderer/frame-extractor.js";
import { composeFinalVideo } from "./src/renderer/video-compositor.js";

const fastify = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === "production"
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

const persistStream = async (fileStream: NodeJS.ReadableStream, filePath: string) => {
  await pipeline(fileStream, fs.createWriteStream(filePath));
  return filePath;
};

fastify.get("/health", async () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
  renderer: "ffmpeg-optimized",
  version: "3.0.0",
}));

fastify.post("/render", async (request, reply) => {
  const parts = request.parts();
  const tempDir = await ensureTempDir();

  let payloadString: string | undefined;
  let videoPath: string | undefined;
  let exportId = `job_${Date.now()}`;

  try {
    // Parse multipart form data
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "video") {
        const filename = part.filename || "source.mp4";
        videoPath = await persistStream(part.file, path.join(tempDir, filename));
        request.log.info({ videoPath }, "Video file received");
      } else if (part.type === "field" && part.fieldname === "payload") {
        payloadString = part.value as string;
      } else if (part.type === "field" && part.fieldname === "exportId") {
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

    const payload = JSON.parse(payloadString) as CaptionExportPayload;

    if (payload.metadata.exportId !== exportId) {
      request.log.warn(
        { exportId, payloadExportId: payload.metadata.exportId },
        "Export ID mismatch"
      );
      exportId = payload.metadata.exportId;
    }

    request.log.info(
      {
        exportId,
        subtitleCount: payload.subtitles.length,
        fontFamily: payload.style.fontFamily,
        canvas: payload.metadata.canvas,
      },
      "Starting optimized render pipeline"
    );

    const fps = 30;

    // STEP 1: Extract video frames using FFmpeg (FAST!)
    const videoFramesDir = path.join(tempDir, "video-frames");
    await mkdir(videoFramesDir, { recursive: true });
    request.log.info("Extracting video frames with FFmpeg...");

    const frameExtractionResult = await extractVideoFrames(videoPath, videoFramesDir, fps);
    request.log.info(
      {
        totalFrames: frameExtractionResult.totalFrames,
        duration: frameExtractionResult.duration,
      },
      "Video frames extracted"
    );

    // STEP 2: Render caption overlays using Puppeteer (SIMPLE!)
    const overlayDir = path.join(tempDir, "overlays");
    await mkdir(overlayDir, { recursive: true });
    request.log.info("Rendering caption overlays...");

    const browser = await createBrowser();
    let browserClosed = false;

    try {
      const overlayResult = await renderCaptionOverlays(
        browser,
        payload,
        frameExtractionResult.totalFrames,
        frameExtractionResult.duration,
        fps,
        overlayDir
      );

      request.log.info(
        { totalOverlays: overlayResult.totalFrames },
        "Caption overlays rendered"
      );

      // Close browser after rendering overlays
      await browser.close();
      browserClosed = true;
      request.log.info("Browser closed after overlay rendering");

      // STEP 3: Composite overlays onto video frames using FFmpeg (FAST!)
      const outputPath = path.join(tempDir, `captioned-${exportId}.mp4`);
      request.log.info("Compositing final video with FFmpeg...");

      await composeFinalVideo({
        videoFramesDir,
        overlayFramesDir: overlayDir,
        audioPath: videoPath,
        outputPath,
        fps,
        totalFrames: frameExtractionResult.totalFrames,
      });

      request.log.info({ outputPath }, "Video composition complete");

      // Stream the output file
      reply.header("Content-Type", "video/mp4");
      reply.header(
        "Content-Disposition",
        `attachment; filename="captioned-${exportId}.mp4"`
      );

      return reply.send(fs.createReadStream(outputPath));
    } catch (renderError) {
      request.log.error({
        error: renderError instanceof Error ? renderError.message : String(renderError),
        stack: renderError instanceof Error ? renderError.stack : undefined
      }, "Frame capture or composition failed");
      throw renderError;
    } finally {
      // Ensure browser is closed even if error occurred
      if (!browserClosed && browser) {
        try {
          await browser.close();
          request.log.info("Browser closed after error");
        } catch (closeError) {
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

    reply.status(500);
    return {
      error: error instanceof Error ? error.message : "Render failed",
      details: error instanceof Error ? error.stack : undefined,
    };
  } finally {
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
  let videoPath: string | undefined;

  try {
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "video") {
        const filename = part.filename || "source.mp4";
        videoPath = await persistStream(part.file, path.join(tempDir, filename));
      }
    }

    if (!videoPath) {
      reply.status(400);
      return { error: "Video file is required" };
    }

    // Import dynamically to avoid circular deps if any, though not expected here
    const { transcribeVideo } = await import("./src/transcription.js");
    const result = await transcribeVideo(videoPath, tempDir);

    return result;

  } catch (error) {
    request.log.error(error, "Transcription failed");
    reply.status(500);
    return {
      error: error instanceof Error ? error.message : "Transcription failed",
    };
  } finally {
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
