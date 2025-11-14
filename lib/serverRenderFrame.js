import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "fs";
import { getVisibleSubtitles } from "./getVisibleSubtitles.js";

/**
 * Server-side frame rendering using @napi-rs/canvas
 * Port of renderFrame.js for server-side use
 */
export async function renderFrame({
  frameImagePath, // Path to frame image file
  subtitles,
  currentTime,
  style,
  width,
  height,
  outputPath, // Path to save rendered frame
}) {
  // Load the frame image
  const frameImage = await loadImage(frameImagePath);
  
  // Create canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // ---- draw video (TikTok-style fill) ----
  const videoRatio = frameImage.width / frameImage.height;
  const canvasRatio = width / height;

  let drawWidth, drawHeight, offsetX, offsetY;

  if (videoRatio > canvasRatio) {
    drawHeight = height;
    drawWidth = height * videoRatio;
    offsetX = (width - drawWidth) / 2;
    offsetY = 0;
  } else {
    drawWidth = width;
    drawHeight = width / videoRatio;
    offsetX = 0;
    offsetY = (height - drawHeight) / 2;
  }

  ctx.drawImage(frameImage, offsetX, offsetY, drawWidth, drawHeight);

  // ----- DRAW SUBTITLES -----
  // Only show the most relevant subtitle at a time to avoid overlapping
  const visibleSubtitles = getVisibleSubtitles(subtitles, currentTime);
  
  visibleSubtitles.forEach((sub) => {

    // convert normalized pos → pixels (position is center-based)
    const px = (sub.position?.x ?? 0.5) * width;
    const py = (sub.position?.y ?? 0.9) * height;

    // Use defaults matching UI
    const fontSize = style.fontSize || 48;
    ctx.font = `600 ${fontSize}px Arial`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    const bgRGB = hexToRgb(style.bgColor || "#000000");
    // CSS rgba() appears lighter than canvas rgba() due to browser compositing
    // Increase opacity slightly in export to match UI visual appearance
    const baseOpacity = style.bgOpacity ?? 0.7;
    const bgOpacity = Math.min(1.0, baseOpacity * 1.15); // Increase by 15% to match UI brightness
    // Only apply background if bgEnabled is true (default to true for backward compatibility)
    const bgEnabled = style.bgEnabled !== false;
    const bg = bgEnabled ? `rgba(${bgRGB.r},${bgRGB.g},${bgRGB.b},${bgOpacity})` : "transparent";

    const strokeColor = style.strokeColor ?? "#000000"; // Match UI default
    const strokeWidth = style.strokeWidth ?? 3; // Match UI default (use ?? to allow 0)
    const strokeEnabled = style.strokeEnabled !== false; // Default to true for backward compatibility

    // ---- Render per-word logic ----
    let wordsToDraw = [];

    if (sub.words) {
      const buffer = 0.05;
      const t = currentTime + buffer;

      wordsToDraw = sub.words.map((w, i) => {
        const active = t >= w.start && t <= w.end;
        const appeared = t >= w.start;
        const aboutTo = t >= w.start - buffer && t < w.start;

        let opacity = 0;
        let weight = 400;

        if (active) {
          opacity = 1;
          weight = 700;
        } else if (aboutTo) {
          opacity = 0.5;
          weight = 500;
        } else if (appeared) {
          opacity = 0.7;
          weight = 600;
        } else {
          opacity = 0.3;
          weight = 400;
        }

        return { ...w, opacity, weight };
      });
    } else {
      wordsToDraw = [{ word: sub.text, opacity: 1, weight: 600 }];
    }

    const finalText = wordsToDraw.map((w) => w.word).join(" ");
    ctx.font = `600 ${fontSize}px Arial`;

    // measure box to match UI exactly
    // UI uses: fontSize (48px), lineHeight: 1.0, padding: "10px 16px"
    // The actual text glyph height is less than fontSize (typically 0.7-0.75 for Arial)
    // Use actual text metrics to get precise measurements
    const textMetrics = ctx.measureText(finalText);
    
    // Match UI EXACTLY: Use the same calculation as UI (now that UI uses actual fontSize)
    // UI: fontSize (actual, no scaling), lineHeight 1.0, padding 20px
    // From console logs: UI fontSize 42.5px -> box height 69px (actual DOM)
    // This gives us the ratio: (69 - 20) / 42.5 = 1.153
    // Now UI uses actual fontSize (e.g., 85px), so box = 85 * 1.153 + 20 = 118px
    // Export should use the SAME calculation: fontSize * 1.153 + 20
    const lineHeight = 1.153; // Calculated from UI actual DOM: (69px - 20px) / 42.5px = 1.153
    const verticalPadding = 20; // 10px top + 10px bottom (matches UI padding: "10px 16px")
    const horizontalPadding = 32; // 16px left + 16px right
    
    // Box height = fontSize * lineHeight + padding (adjusted to match UI actual DOM measurement)
    const boxWidth = textMetrics.width + horizontalPadding;
    const boxHeight = fontSize * lineHeight + verticalPadding;

    // Log export styling values for comparison
    // console.log('=== EXPORT STYLING VALUES (serverRenderFrame) ===');
    // console.log('Style object:', style);
    // console.log('Export fontSize:', fontSize, 'px');
    // console.log('Export lineHeight:', lineHeight);
    // console.log('Export verticalPadding:', verticalPadding, 'px');
    // console.log('Export horizontalPadding:', horizontalPadding, 'px');
    // console.log('Export calculated box height:', boxHeight, 'px');
    // console.log('Export calculated box width:', boxWidth, 'px');
    // console.log('Export text width:', textMetrics.width, 'px');
    // console.log('Export bgColor:', bg);
    // console.log('Export bgOpacity:', bgOpacity);
    // console.log('Export strokeColor:', strokeColor);
    // console.log('Export strokeWidth:', strokeWidth);
    // console.log('UI equivalent (2x): fontSize', fontSize * 0.5, 'px, box height', boxHeight * 0.5, 'px');
    const boxX = px - boxWidth / 2;
    const boxY = py - boxHeight / 2;
    const borderRadius = 8;

    // Draw box shadow first (0 2px 8px rgba(0, 0, 0, 0.3)) - only if background is enabled
    if (bgEnabled) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = bg;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, borderRadius);
    ctx.fill();
    ctx.restore();

    // Draw background box
    ctx.fillStyle = bg;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, borderRadius);
    ctx.fill();
    }

    // Draw border (strokeWidth px solid strokeColor) - only if stroke is enabled
    if (strokeEnabled) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, borderRadius);
    ctx.stroke();
    }

    // draw words individually to apply opacity & weight with double text shadow
    let cursorX = px - textMetrics.width / 2;

    wordsToDraw.forEach((w) => {
      ctx.globalAlpha = w.opacity;
      ctx.font = `${w.weight} ${fontSize}px Arial`;

        const width = ctx.measureText(w.word + " ").width;
        const wordX = cursorX + width / 2;
        const wordY = py;
        const stroke = strokeWidth;
        const strokeCol = strokeColor;

      // Draw text shadow/glow effect (matching UI: 0 0 strokeWidth px, 0 0 strokeWidth*2 px)
      // CSS text-shadow with 0,0 offset creates a glow around the text
      // Draw multiple layers to create the glow effect - only if stroke is enabled
      if (strokeEnabled) {
      // Outer glow layer (larger blur, stroke * 2)
      ctx.save();
      ctx.shadowColor = strokeCol;
      ctx.shadowBlur = stroke * 2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = strokeCol;
      ctx.fillText(w.word, wordX, wordY);
      ctx.restore();

      // Inner glow layer (smaller blur, stroke)
      ctx.save();
      ctx.shadowColor = strokeCol;
      ctx.shadowBlur = stroke;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = strokeCol;
      ctx.fillText(w.word, wordX, wordY);
      ctx.restore();
      }

      // Finally draw the text in actual color (overlays everything, no shadow)
      ctx.save();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.fillStyle = style.color || "#FFFFFF"; // Match UI default
      ctx.fillText(w.word, wordX, wordY);
      ctx.restore();

      cursorX += width;
    });

    ctx.globalAlpha = 1;
  });

  // Save the rendered frame
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outputPath, buffer);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgb(hex) {
  if (!hex) return { r: 0, g: 0, b: 0 };
  const cleaned = hex.replace("#", "");
  const m = cleaned.match(/.{1,2}/g);
  if (!m || m.length !== 3) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[0], 16),
    g: parseInt(m[1], 16),
    b: parseInt(m[2], 16),
  };
}


