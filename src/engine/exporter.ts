import type { StagecraftProject } from '../state/types.js';
import { ASPECT_RATIO_DIMENSIONS, getBackdropById } from '../demo/presets.js';
import { renderCompositeFrame } from './compositor.js';
import { selectSupportedVideoMimeType } from './recorder.js';
import { clamp } from './spring.js';

export interface VideoExportOptions {
  fps: 30 | 60;
  resolutionScale: 0.75 | 1.0 | 1.35; // 720p, 1080p, 1440p
  onProgress?: (progress: number, currentFrame: number, totalFrames: number) => void;
  signal?: AbortSignal;
}

/**
 * Renders the project timeline to a downloadable video Blob (.webm / .mp4) locally in the browser.
 */
export async function exportCompositeVideo(
  project: StagecraftProject,
  sourceVideo: HTMLVideoElement | null,
  options: VideoExportOptions,
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const dims = ASPECT_RATIO_DIMENSIONS[project.style.aspectRatio];
  const width = Math.round(dims.width * options.resolutionScale);
  const height = Math.round(dims.height * options.resolutionScale);

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D rendering context for export.');
  }

  const startSec = clamp(project.trimStart, 0, project.duration - 0.2);
  const endSec = clamp(project.trimEnd, startSec + 0.2, project.duration);
  const exportDuration = endSec - startSec;
  const totalFrames = Math.max(1, Math.round(exportDuration * options.fps));

  const stream = exportCanvas.captureStream(options.fps);
  const mimeType = selectSupportedVideoMimeType() || 'video/webm';
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: options.resolutionScale >= 1.0 ? 14_000_000 : 8_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = ev => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => {
      reject(new Error('MediaRecorder failed during local video export.'));
    };
  });

  recorder.start(100);

  for (let frame = 0; frame <= totalFrames; frame++) {
    if (options.signal?.aborted) {
      recorder.stop();
      throw new Error('Export cancelled.');
    }
    const t = startSec + (frame / totalFrames) * exportDuration;
    if (sourceVideo && sourceVideo.readyState >= 2) {
      sourceVideo.currentTime = Math.min(sourceVideo.duration || t, t);
    }
    renderCompositeFrame(ctx, width, height, {
      project,
      timeSec: t,
      sourceVideo,
    });
    options.onProgress?.(frame / totalFrames, frame, totalFrames);
    await new Promise<void>(r => setTimeout(r, Math.round(1000 / options.fps)));
  }

  recorder.stop();
  const blob = await stopped;
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    blob,
    filename: `${slug || 'stagecraft-demo'}.${ext}`,
    mimeType,
  };
}

/**
 * Generates a self-contained, single-file interactive HTML product walkthrough (Arcade style)
 * where viewers can step through pulsing hotspots and experience spring-physics camera zooms.
 */
export function generateInteractiveWalkthroughHtml(project: StagecraftProject): string {
  const theme = getBackdropById(project.style.backdropId);
  const steps =
    project.spotlights.length > 0
      ? project.spotlights.map(s => ({
          title: s.title,
          description: s.description,
          x: s.x,
          y: s.y,
          time: s.time,
        }))
      : project.zoomSegments.map((z, idx) => ({
          title: z.label ?? `Step ${idx + 1}`,
          description: `Focuses at ${z.scale.toFixed(2)}x magnification (${z.startTime.toFixed(1)}s – ${z.endTime.toFixed(1)}s).`,
          x: z.targetX,
          y: z.targetY,
          time: z.startTime,
        }));

  const safeTitle = escapeHtml(project.name);
  const safeWindowTitle = escapeHtml(project.style.windowTitle);
  const stepsJson = JSON.stringify(steps).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} · Interactive Walkthrough</title>
<style>
  :root {
    --bg-0: ${theme.primaryStops[0]};
    --bg-1: ${theme.primaryStops[1]};
    --bg-2: ${theme.primaryStops[2]};
    --accent: ${theme.accentColor};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    background: #07080C;
    color: #F8FAFC;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .player-shell {
    width: min(1080px, 96vw);
    aspect-ratio: 16 / 9;
    background: linear-gradient(135deg, var(--bg-0), var(--bg-1), var(--bg-2));
    border-radius: 22px;
    padding: 44px;
    position: relative;
    overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.14);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .window-card {
    width: 100%;
    height: 100%;
    background: #0D1017;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    position: relative;
    overflow: hidden;
    transition: transform 0.65s cubic-bezier(0.22, 1.18, 0.36, 1);
  }
  .window-header {
    height: 38px;
    background: #141822;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 8px;
    font-size: 13px;
    color: #94A3B8;
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot.r { background: #FF5F56; }
  .dot.y { background: #FFBD2E; }
  .dot.g { background: #27C93F; }
  .hotspot {
    position: absolute;
    width: 44px;
    height: 44px;
    margin-left: -22px;
    margin-top: -22px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    background: rgba(99, 102, 241, 0.25);
    cursor: pointer;
    animation: pulse 1.8s infinite;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    color: #fff;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(129, 140, 248, 0.65); }
    70% { box-shadow: 0 0 0 18px rgba(129, 140, 248, 0); }
    100% { box-shadow: 0 0 0 0 rgba(129, 140, 248, 0); }
  }
  .hud-bar {
    margin-top: 18px;
    width: min(1080px, 96vw);
    background: #11131A;
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 14px;
    padding: 16px 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .step-title { font-weight: 600; font-size: 16px; color: #F8FAFC; }
  .step-desc { font-size: 14px; color: #94A3B8; margin-top: 4px; }
  .btn {
    background: rgba(255,255,255,0.08);
    color: #F8FAFC;
    border: 1px solid rgba(255,255,255,0.12);
    padding: 8px 16px;
    border-radius: 9px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn.primary { background: #6366F1; border-color: #818CF8; }
</style>
</head>
<body>
  <div class="player-shell">
    <div class="window-card" id="winCard">
      <div class="window-header">
        <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span style="margin-left:auto;margin-right:auto">${safeWindowTitle}</span>
      </div>
      <div id="hotspotLayer" style="position:relative;width:100%;height:calc(100% - 38px);background:radial-gradient(circle at 30% 35%, rgba(99,102,241,0.16), transparent 60%);">
      </div>
    </div>
  </div>
  <div class="hud-bar">
    <div>
      <div class="step-title" id="stepTitle"></div>
      <div class="step-desc" id="stepDesc"></div>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" id="prevBtn">← Prev</button>
      <button class="btn primary" id="nextBtn">Next Step →</button>
    </div>
  </div>
<script>
  const steps = ${stepsJson};
  let idx = 0;
  const winCard = document.getElementById('winCard');
  const layer = document.getElementById('hotspotLayer');
  const titleEl = document.getElementById('stepTitle');
  const descEl = document.getElementById('stepDesc');

  function renderStep() {
    const s = steps[idx] || { title: 'Overview', description: 'Interactive walkthrough exported from Stagecraft.', x: 0.5, y: 0.5 };
    titleEl.textContent = s.title + ' (' + (idx + 1) + '/' + Math.max(1, steps.length) + ')';
    descEl.textContent = s.description;
    layer.innerHTML = '';
    const spot = document.createElement('button');
    spot.className = 'hotspot';
    spot.style.left = (s.x * 100) + '%';
    spot.style.top = (s.y * 100) + '%';
    spot.textContent = String(idx + 1);
    spot.onclick = () => { idx = (idx + 1) % Math.max(1, steps.length); renderStep(); };
    layer.appendChild(spot);
    const tx = (0.5 - s.x) * 32;
    const ty = (0.5 - s.y) * 32;
    winCard.style.transform = 'scale(1.38) translate(' + tx + '%, ' + ty + '%)';
  }
  document.getElementById('prevBtn').onclick = () => { idx = (idx - 1 + steps.length) % steps.length; renderStep(); };
  document.getElementById('nextBtn').onclick = () => { idx = (idx + 1) % steps.length; renderStep(); };
  renderStep();
</script>
</body>
</html>`;
}

export function serializeProjectJson(project: StagecraftProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectJson(raw: string): StagecraftProject {
  const parsed = JSON.parse(raw) as Partial<StagecraftProject>;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.version !== '1.0' ||
    typeof parsed.duration !== 'number' ||
    !Array.isArray(parsed.zoomSegments) ||
    !Array.isArray(parsed.cursorTrack) ||
    !parsed.style
  ) {
    throw new Error('Invalid Stagecraft project file format.');
  }
  return parsed as StagecraftProject;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
