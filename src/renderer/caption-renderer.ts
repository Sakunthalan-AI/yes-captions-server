import type { CaptionExportPayload } from "../types.js";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Font mapping for Google Fonts
 */
const GOOGLE_FONTS_MAP: Record<string, string> = {
  "Bebas Neue": "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
  "Inter": "https://fonts.googleapis.com/css2?family=Inter:wght@100;300;400;500;600;700;800;900&display=swap",
  "Poppins": "https://fonts.googleapis.com/css2?family=Poppins:wght@100;200;300;400;500;600;700;800;900&display=swap",
  "Orbitron": "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap",
  "Playfair Display": "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800;900&display=swap",
  "Luckiest Guy": "https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap",
  "Montserrat": "https://fonts.googleapis.com/css2?family=Montserrat:wght@100;200;300;400;500;600;700;800;900&display=swap",
  "Bangers": "https://fonts.googleapis.com/css2?family=Bangers&display=swap",
  "Comic Neue": "https://fonts.googleapis.com/css2?family=Comic+Neue:wght@300;400;700;900&display=swap",
  "Rajdhani": "https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&display=swap",
  "Cinzel Decorative": "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700;900&display=swap",
  "Monoton": "https://fonts.googleapis.com/css2?family=Monoton&display=swap",
  "Creepster": "https://fonts.googleapis.com/css2?family=Creepster&display=swap",
  "Dancing Script": "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;500;600;700&display=swap",
};

function getFontUrl(fontFamily: string): string | null {
  const primaryFont = fontFamily.split(",")[0].trim().replace(/['"]/g, "");
  return GOOGLE_FONTS_MAP[primaryFont] || null;
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0, 0, 0";
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

/**
 * Generate HTML template for rendering
 */
async function generateHTML(payload: CaptionExportPayload, videoPath: string): Promise<string> {
  const { style, metadata, subtitles } = payload;
  const { canvas } = metadata;
  const fontUrl = getFontUrl(style.fontFamily || "Inter");

  // Properly encode file path for file:// URL (handles spaces and special chars)
  const { pathToFileURL } = await import("node:url");
  const videoFileUrl = pathToFileURL(videoPath).href;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${fontUrl ? `<link rel="stylesheet" href="${fontUrl}">` : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #000; }
    #container { position: relative; width: ${canvas.width}px; height: ${canvas.height}px; background: #000; }
    #video { width: 100%; height: 100%; object-fit: cover; display: block; }
    #caption-overlay { position: absolute; top: 0; left: 0; width: ${canvas.width}px; height: ${canvas.height}px; pointer-events: none; }
    .caption {
      position: absolute;
      text-align: center;
      white-space: normal;
      word-wrap: break-word;
      max-width: 90%;
      left: 50%;
      transform: translateX(-50%);
      font-family: ${style.fontFamily || "Inter, sans-serif"};
      font-size: ${style.fontSize}px;
      font-weight: ${style.fontWeight || 700};
      color: ${style.color};
      line-height: 1.0;
      padding: ${style.backgroundEnabled ? "10px 16px" : "0"};
      background: ${style.backgroundEnabled ? `rgba(${hexToRgb(style.backgroundColor)}, ${style.backgroundOpacity})` : "transparent"};
      border-radius: ${style.backgroundEnabled || style.strokeEnabled ? "8px" : "0"};
      ${style.strokeEnabled ? `text-shadow: 0 0 ${style.strokeWidth}px ${style.strokeColor}, 0 0 ${style.strokeWidth * 2}px ${style.strokeColor}; border: ${style.strokeWidth}px solid ${style.strokeColor};` : ""}
      ${style.backgroundEnabled ? "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);" : ""}
      display: none;
    }
    .caption .word {
      display: inline-block;
      margin-right: 0.3em;
      transition: opacity 0.1s ease, font-weight 0.1s ease;
    }
    .caption .word:last-child { margin-right: 0; }
  </style>
</head>
<body>
  <div id="container">
    <video id="video" src="${videoFileUrl}" playsinline muted></video>
    <div id="caption-overlay"></div>
  </div>
  <script>
    const PAYLOAD = ${JSON.stringify(payload)};
    const video = document.getElementById('video');
    const overlay = document.getElementById('caption-overlay');
    
    PAYLOAD.subtitles.forEach(subtitle => {
      const captionDiv = document.createElement('div');
      captionDiv.className = 'caption';
      captionDiv.dataset.id = subtitle.id;
      captionDiv.dataset.start = subtitle.start;
      captionDiv.dataset.end = subtitle.end;
      captionDiv.style.top = \`\${subtitle.position.yPct * 100}%\`;
      captionDiv.style.transform = 'translate(-50%, -50%)';
      
      if (subtitle.words && subtitle.words.length > 0) {
        subtitle.words.forEach(word => {
          const wordSpan = document.createElement('span');
          wordSpan.className = 'word';
          wordSpan.textContent = word.word;
          wordSpan.dataset.start = word.states.activeStart;
          wordSpan.dataset.end = word.states.activeEnd;
          wordSpan.dataset.appear = word.states.appear;
          wordSpan.dataset.fade = word.states.fade;
          captionDiv.appendChild(wordSpan);
        });
      } else {
        captionDiv.textContent = subtitle.text;
      }
      overlay.appendChild(captionDiv);
    });
    
    function updateCaptions() {
      const currentTime = video.currentTime;
      const TIMING_BUFFER = 0.05;
      const adjustedTime = currentTime + TIMING_BUFFER;
      
      document.querySelectorAll('.caption').forEach(caption => {
        const start = parseFloat(caption.dataset.start);
        const end = parseFloat(caption.dataset.end);
        
        if (adjustedTime >= start && adjustedTime <= end) {
          caption.style.display = 'block';
          
          caption.querySelectorAll('.word').forEach(word => {
            const wordStart = parseFloat(word.dataset.start);
            const wordEnd = parseFloat(word.dataset.end);
            const appear = parseFloat(word.dataset.appear);
            const fade = parseFloat(word.dataset.fade);
            
            const isActive = adjustedTime >= wordStart && adjustedTime <= wordEnd;
            const hasAppeared = adjustedTime >= wordStart;
            const isAboutToAppear = adjustedTime >= (wordStart - TIMING_BUFFER) && adjustedTime < wordStart;
            
            let opacity = 0, fontWeight = 400;
            if (isActive) { opacity = 1; fontWeight = 700; }
            else if (isAboutToAppear) { opacity = 0.5; fontWeight = 500; }
            else if (hasAppeared && adjustedTime <= fade) { opacity = 0.7; fontWeight = 600; }
            else if (adjustedTime < wordStart) { opacity = 0.3; fontWeight = 400; }
            
            word.style.opacity = opacity;
            word.style.fontWeight = fontWeight;
          });
        } else {
          caption.style.display = 'none';
        }
      });
    }
    
    window.captionRendererReady = true;
    window.updateCaptions = updateCaptions;
    video.addEventListener('timeupdate', updateCaptions);
    video.addEventListener('seeked', updateCaptions);
  </script>
</body>
</html>`;
}

export interface FrameCaptureResult {
  framePaths: string[];
  totalFrames: number;
  duration: number;
}

/**
 * Capture video frames with captions
 */
export async function captureFrames(
  browser: Browser,
  payload: CaptionExportPayload,
  videoPath: string,
  outputDir: string,
  fps: number = 30,
  quality: number = 85,
  concurrency: number = 4 // Restore concurrency to 4 for speed
): Promise<FrameCaptureResult> {
  console.log(`captureFrames: Starting with concurrency=${concurrency}...`);
  console.log("captureFrames: videoPath =", videoPath);

  // 1. Setup the first page to get video metadata (duration)
  const mainPage = await browser.newPage();
  await setupPage(mainPage, payload, videoPath, outputDir);

  // Get video duration
  const duration = await mainPage.evaluate(`new Promise((resolve) => {
    const videoEl = document.getElementById("video");
    const handler = () => { resolve(videoEl.duration); videoEl.removeEventListener("loadedmetadata", handler); };
    if (videoEl.readyState >= 1) resolve(videoEl.duration);
    else videoEl.addEventListener("loadedmetadata", handler);
  })`) as number;

  const totalFrames = Math.ceil(duration * fps);
  console.log(`Total frames: ${totalFrames}, Duration: ${duration}s`);

  // 2. Calculate chunks for parallel processing
  const framesPerWorker = Math.ceil(totalFrames / concurrency);
  const chunks: { start: number; end: number; index: number }[] = [];

  for (let i = 0; i < concurrency; i++) {
    const start = i * framesPerWorker;
    const end = Math.min((i + 1) * framesPerWorker, totalFrames);
    if (start < totalFrames) {
      chunks.push({ start, end, index: i });
    }
  }

  console.log(`Split into ${chunks.length} chunks for parallel processing`);

  // 3. Define worker function
  const processChunk = async (chunkIndex: number, startFrame: number, endFrame: number, existingPage?: Page) => {
    const page = existingPage || await browser.newPage();
    if (!existingPage) {
      await setupPage(page, payload, videoPath, outputDir);
    }

    const chunkFramePaths: string[] = [];
    const frameInterval = 1 / fps;

    console.log(`Worker ${chunkIndex}: Processing frames ${startFrame} to ${endFrame}`);

    for (let i = startFrame; i < endFrame; i++) {
      const currentTime = i * frameInterval;

      // Optimized seek logic: 'seeked' + double RAF
      // This is much faster than requestVideoFrameCallback for seeking and reliable enough
      await page.evaluate(`new Promise((resolve) => {
        const videoEl = document.getElementById("video");
        const targetTime = ${currentTime};
        
        const onSeeked = () => {
            // Double RAF ensures the frame is painted to the canvas/compositor
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    window.updateCaptions();
                    resolve();
                });
            });
        };
        
        videoEl.addEventListener("seeked", onSeeked, { once: true });
        videoEl.currentTime = targetTime;
      })`);

      const framePath = path.join(outputDir, `frame-${String(i).padStart(6, "0")}.jpg`);
      await page.screenshot({ path: framePath, type: "jpeg", quality, fullPage: false });
      chunkFramePaths.push(framePath);

      if (i % 30 === 0) {
        console.log(`Worker ${chunkIndex}: Captured frame ${i}/${totalFrames}`);
      }
    }

    if (!existingPage) {
      await page.close();
    }
    return chunkFramePaths;
  };

  // 4. Run workers in parallel
  // Reuse mainPage for the first chunk to save setup time
  const promises = chunks.map((chunk, i) => {
    if (i === 0) {
      return processChunk(chunk.index, chunk.start, chunk.end, mainPage);
    } else {
      return processChunk(chunk.index, chunk.start, chunk.end);
    }
  });

  const results = await Promise.all(promises);

  // Close main page after first chunk is done
  await mainPage.close();

  // 5. Flatten results
  const allFramePaths = results.flat().sort();

  return { framePaths: allFramePaths, totalFrames, duration };
}

/**
 * Helper to setup a page with the rendering environment
 */
async function setupPage(page: Page, payload: CaptionExportPayload, videoPath: string, outputDir: string) {
  await page.setViewport({
    width: payload.metadata.canvas.width,
    height: payload.metadata.canvas.height,
    deviceScaleFactor: 1,
  });

  // We can reuse the generated HTML file if it exists, but generating it is fast
  const html = await generateHTML(payload, videoPath);
  const htmlPath = path.join(outputDir, `render-${Math.random().toString(36).substring(7)}.html`);
  await writeFile(htmlPath, html, "utf8");

  await page.goto(`file://${htmlPath}`, {
    waitUntil: "load",
    timeout: 60000
  });

  await page.evaluateHandle("document.fonts.ready");
  await page.waitForFunction(() => window.captionRendererReady, { timeout: 10000 });
}

/**
 * Create a browser instance for rendering
 * We create a fresh instance for each render to avoid WebSocket connection issues
 */
export async function createBrowser(): Promise<Browser> {
  console.log("Launching fresh Puppeteer browser...");

  // Use system Chrome on macOS to avoid launch issues
  const executablePath = process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined;

  const browser = await puppeteer.launch({
    headless: "new", // Use new headless mode
    executablePath, // Use system Chrome on macOS
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });
  console.log("Browser launched successfully with", executablePath || "bundled Chrome");
  return browser;
}

/**
 * DEPRECATED: Don't use shared browser - causes connection issues
 */
let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  // Always create a fresh browser to avoid ECONNRESET errors
  return createBrowser();
}

/**
 * Close a browser instance
 */
export async function closeBrowserInstance(browser: Browser): Promise<void> {
  if (browser && browser.connected) {
    await browser.close();
    console.log("Browser instance closed");
  }
}

/**
 * Close the shared browser instance (legacy)
 */
export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
    console.log("Shared browser closed");
  }
}
