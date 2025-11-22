import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import type { CaptionExportPayload } from "../types.js";

// Extend Window interface for our custom functions
declare global {
  interface Window {
    captionRendererReady: boolean;
    updateCaptions: (currentTime: number) => void;
    captureFrame: () => Promise<string | null>;
  }
}

/**
 * Map font families to their local file names/patterns
 */
const LOCAL_FONT_MAP: Record<string, string> = {
  "Bebas Neue": "BebasNeue-Regular.ttf",
  "Inter": "Inter-VariableFont_opsz,wght.ttf",
  "Poppins": "Poppins-Regular.ttf", // Default, logic below handles weights
  "Orbitron": "Orbitron-VariableFont_wght.ttf",
  "Playfair Display": "PlayfairDisplay-VariableFont_wght.ttf",
  "Luckiest Guy": "LuckiestGuy-Regular.ttf",
  "Montserrat": "Montserrat-VariableFont_wght.ttf",
  "Bangers": "Bangers-Regular.ttf",
  "Comic Neue": "ComicNeue-Regular.ttf", // Logic below handles weights
  "Rajdhani": "Rajdhani-Regular.ttf", // Logic below handles weights
  "Cinzel Decorative": "CinzelDecorative-Regular.ttf",
  "Monoton": "Monoton-Regular.ttf",
  "Creepster": "Creepster-Regular.ttf", // Assuming regular exists or we map to what we have
  "Dancing Script": "DancingScript-VariableFont_wght.ttf",
};

/**
 * Get the local font file path based on family and weight
 */
async function getLocalFontBase64(fontFamily: string, fontWeight: number | string = 400): Promise<string | null> {
  const primaryFont = fontFamily.split(",")[0].trim().replace(/['"]/g, "");
  const fontsDir = path.join(process.cwd(), "fonts");

  let filename = LOCAL_FONT_MAP[primaryFont];

  // Handle specific weights for non-variable fonts if needed
  if (primaryFont === "Poppins") {
    const weightMap: Record<string, string> = {
      "100": "Thin", "200": "ExtraLight", "300": "Light", "400": "Regular",
      "500": "Medium", "600": "SemiBold", "700": "Bold", "800": "ExtraBold", "900": "Black"
    };
    const weightName = weightMap[String(fontWeight)] || "Regular";
    filename = `Poppins-${weightName}.ttf`;
  } else if (primaryFont === "Rajdhani") {
    const weightMap: Record<string, string> = {
      "300": "Light", "400": "Regular", "500": "Medium", "600": "SemiBold", "700": "Bold"
    };
    const weightName = weightMap[String(fontWeight)] || "Regular";
    filename = `Rajdhani-${weightName}.ttf`;
  }

  if (!filename) return null;

  try {
    const fontPath = path.join(fontsDir, filename);
    const fontBuffer = await readFile(fontPath);
    return `data:font/ttf;base64,${fontBuffer.toString("base64")}`;
  } catch (error) {
    console.warn(`Failed to load local font: ${filename}`, error);
    return null;
  }
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0, 0, 0";
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

/**
 * Generate HTML template for caption overlay rendering (transparent background)
 * Includes Canvas rasterization for performance
 */
async function generateOverlayHTML(payload: CaptionExportPayload): Promise<string> {
  const { style, metadata, subtitles } = payload;
  const { canvas } = metadata;

  const fontBase64 = await getLocalFontBase64(style.fontFamily || "Inter", style.fontWeight);
  const fontFamilyName = style.fontFamily ? style.fontFamily.split(",")[0].trim().replace(/['"]/g, "") : "Inter";

  // Extract CSS as a variable for reuse in SVG
  const cssStyles = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: transparent; margin: 0; padding: 0; }
    #container { position: relative; width: ${canvas.width}px; height: ${canvas.height}px; background: transparent; }
    #caption-overlay { position: absolute; top: 0; left: 0; width: ${canvas.width}px; height: ${canvas.height}px; }
    .caption {
      position: absolute;
      text-align: center;
      white-space: normal;
      word-wrap: break-word;
      max-width: 90%;
      left: 50%;
      transform: translateX(-50%);
      font-family: '${fontFamilyName}', ${style.fontFamily || "sans-serif"};
      font-size: ${style.fontSize * 0.88}px;
      font-weight: ${style.fontWeight || 700};
      color: ${style.color};
      line-height: 1.0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
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
      transition: none;
    }
    .caption .word:last-child { margin-right: 0; }
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${fontBase64 ? `
    @font-face {
      font-family: '${fontFamilyName}';
      src: url('${fontBase64}') format('truetype');
      font-weight: ${style.fontWeight || "normal"};
      font-style: normal;
    }
    ` : ""}
    ${cssStyles}
  </style>
</head>
<body>
  <div id="container">
    <div id="caption-overlay"></div>
  </div>
  
  <!-- Hidden canvas for rasterization -->
  <canvas id="render-canvas" width="${canvas.width}" height="${canvas.height}" style="display: none;"></canvas>

  <script>
    const PAYLOAD = ${JSON.stringify(payload)};
    const overlay = document.getElementById('caption-overlay');
    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d');
    
    // Store CSS for SVG reuse
    const CSS_STYLES = \`${cssStyles.replace(/`/g, '\\`')}\`;
    const FONT_BASE64 = ${fontBase64 ? `\`${fontBase64}\`` : 'null'};
    const FONT_FAMILY_NAME = '${fontFamilyName}';
    const FONT_WEIGHT = ${style.fontWeight || 400};
    
    // Build DOM elements
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
    
    // Update DOM state based on time
    window.updateCaptions = function(currentTime) {
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
    };

    // Rasterize current DOM state to Canvas and return Data URL
    window.captureFrame = function() {
      const container = document.getElementById('container');
      
      // Serialize the container HTML
      const xmlSerializer = new XMLSerializer();
      const htmlContent = xmlSerializer.serializeToString(container);
      
      // Create SVG with foreignObject
      const svg = \`
        <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
          <style>
            \${CSS_STYLES}
            \${FONT_BASE64 ? \`
            @font-face {
              font-family: '\${FONT_FAMILY_NAME}';
              src: url('\${FONT_BASE64}') format('truetype');
              font-weight: \${FONT_WEIGHT};
              font-style: normal;
            }
            \` : ''}
          </style>
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml">
              \${htmlContent}
            </div>
          </foreignObject>
        </svg>
      \`;
      
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => {
          console.error("SVG load error", e);
          resolve(null);
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    };
    
    window.captionRendererReady = true;
  </script>
</body>
</html>`;
}

export interface OverlayRenderResult {
  overlayPaths: string[];
  totalFrames: number;
}

/**
 * Render caption overlays using Canvas Data URL extraction
 * Optimized with parallel processing for 3-6x speedup
 */
export async function renderCaptionOverlays(
  browser: Browser,
  payload: CaptionExportPayload,
  totalFrames: number,
  duration: number,
  fps: number,
  outputDir: string,
  onProgress?: (progress: number) => void
): Promise<OverlayRenderResult> {
  // CONCURRENCY SETTING: Adjust based on server capacity
  const CONCURRENCY = 4;

  console.log(`Rendering ${totalFrames} caption overlays with concurrency ${CONCURRENCY} (Canvas Mode)...`);

  // Create shared HTML file once
  const html = await generateOverlayHTML(payload);
  const htmlPath = path.join(outputDir, "overlay-render.html");
  await writeFile(htmlPath, html, "utf8");
  const fileUrl = `file://${htmlPath}`;

  // Calculate chunks
  const framesPerWorker = Math.ceil(totalFrames / CONCURRENCY);
  const chunks = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    const start = i * framesPerWorker;
    const end = Math.min((i + 1) * framesPerWorker, totalFrames);
    if (start < totalFrames) {
      chunks.push({ id: i, start, end });
    }
  }

  let completedFrames = 0;
  const frameInterval = 1 / fps;

  // Worker function to process a chunk of frames
  const processChunk = async (chunk: { id: number, start: number, end: number }) => {
    const page = await browser.newPage();

    try {
      await page.setViewport({
        width: payload.metadata.canvas.width,
        height: payload.metadata.canvas.height,
        deviceScaleFactor: 1,
      });

      await page.goto(fileUrl, { waitUntil: "load", timeout: 60000 });

      // Wait for readiness
      await page.evaluateHandle("document.fonts.ready");
      await page.waitForFunction(() => window.captionRendererReady, { timeout: 10000 });

      // Initial warm-up to ensure fonts render
      await page.evaluate(`new Promise(resolve => setTimeout(resolve, 200))`);

      // Process frames in this chunk
      for (let i = chunk.start; i < chunk.end; i++) {
        const currentTime = i * frameInterval;

        // Update captions AND capture frame using canvas
        const dataUrl = await page.evaluate(async (time) => {
          window.updateCaptions(time);
          // Small yield to let DOM update
          await new Promise(r => requestAnimationFrame(r));
          return await window.captureFrame();
        }, currentTime) as string;

        if (dataUrl) {
          // Remove Data URL header "data:image/png;base64,"
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
          const overlayPath = path.join(outputDir, `overlay-${String(i).padStart(6, "0")}.png`);
          await writeFile(overlayPath, base64Data, 'base64');
        }

        completedFrames++;

        // Report progress (aggregated across workers)
        if (onProgress && completedFrames % 10 === 0) {
          onProgress(completedFrames / totalFrames);
        }
      }

      console.log(`Worker ${chunk.id} finished frames ${chunk.start}-${chunk.end}`);
    } catch (err) {
      console.error(`Worker ${chunk.id} failed:`, err);
      throw err;
    } finally {
      await page.close();
    }
  };

  // Run all chunks in parallel
  await Promise.all(chunks.map(processChunk));

  return { overlayPaths: [], totalFrames };
}

/**
 * Create a browser instance for rendering
 */
export async function createBrowser(): Promise<Browser> {
  console.log("Launching Puppeteer browser for overlay rendering...");

  const executablePath = process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined;

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });

  console.log("Browser launched successfully");
  return browser;
}
