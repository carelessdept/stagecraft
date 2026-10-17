import type {
  CameraFrameState,
  EvaluatedCursorState,
  KeystrokeEvent,
  SpotlightStep,
  StagecraftProject,
} from '../state/types.js';
import { getBackdropById } from '../demo/presets.js';
import { renderProceduralAppScene, roundRect } from '../demo/scene-renderer.js';
import { evaluateCursorAtTime } from './cursor.js';
import { clamp, evaluateCameraAtTime } from './spring.js';

export interface CompositorFrameContext {
  project: StagecraftProject;
  timeSec: number;
  sourceVideo?: HTMLVideoElement | null;
  webcamVideo?: HTMLVideoElement | null;
  showTargetReticle?: boolean;
  selectedZoomId?: string | null;
  splitCompareRatio?: number | null; // 0..1 when Before/After split comparison is active
}

export interface RenderedFrameDiagnostics {
  camera: CameraFrameState;
  cursor: EvaluatedCursorState;
  activeKeystroke: KeystrokeEvent | null;
  activeSpotlight: SpotlightStep | null;
  windowRect: { x: number; y: number; w: number; h: number; headerH: number };
}

/**
 * Renders a complete Stagecraft composite frame onto `ctx` at resolution `(canvasWidth, canvasHeight)`.
 */
export function renderCompositeFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  frameCtx: CompositorFrameContext,
): RenderedFrameDiagnostics {
  const { project, timeSec, sourceVideo, webcamVideo, showTargetReticle, selectedZoomId } =
    frameCtx;
  const style = project.style;

  // 1. Evaluate cursor & spring camera at `timeSec`
  const cursor = evaluateCursorAtTime(
    project.cursorTrack,
    timeSec,
    style.cursorSmoothing,
  );
  const camera = evaluateCameraAtTime(project, timeSec, t =>
    evaluateCursorAtTime(project.cursorTrack, t, style.cursorSmoothing),
  );

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // 2. Render Studio Backdrop + Radial Mesh Glows
  renderStudioBackdrop(ctx, canvasWidth, canvasHeight, style.backdropId);

  // Scale factor relative to 1080p reference height
  const refScale = Math.min(canvasWidth / 1920, canvasHeight / 1080);
  const pad = style.padding * refScale;
  const radius = style.cornerRadius * refScale;

  const winW = Math.max(240, canvasWidth - pad * 2);
  const winH = Math.max(160, canvasHeight - pad * 2);
  const winX = (canvasWidth - winW) / 2;
  const winY = (canvasHeight - winH) / 2;
  const headerH =
    style.windowChrome === 'none'
      ? 0
      : style.windowChrome === 'minimal'
        ? Math.round(28 * refScale)
        : Math.round(42 * refScale);

  // 3. Apply Camera Zoom + Optional Perspective Tilt Transform around canvas center
  ctx.save();
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const dynX = style.dynamicTilt ? (cursor.y - 0.5) * -2.2 : 0;
  const dynY = style.dynamicTilt ? (cursor.x - 0.5) * 2.2 : 0;
  const totalTiltXDeg = clamp(style.tiltX + dynX, -18, 18);
  const totalTiltYDeg = clamp(style.tiltY + dynY, -18, 18);

  // Camera translation so (camera.focusX, camera.focusY) inside the window stays centered when zoomed
  const focusCanvasX = winX + camera.focusX * winW;
  const focusCanvasY = winY + camera.focusY * winH;

  ctx.translate(centerX, centerY);
  if (Math.abs(totalTiltXDeg) > 0.05 || Math.abs(totalTiltYDeg) > 0.05) {
    const totalTiltX = totalTiltXDeg * (Math.PI / 180);
    const totalTiltY = totalTiltYDeg * (Math.PI / 180);
    const cosY = Math.cos(totalTiltY * 0.45);
    const cosX = Math.cos(totalTiltX * 0.45);
    const shearX = Math.sin(totalTiltY) * 0.06;
    const shearY = Math.sin(totalTiltX) * 0.045;
    ctx.transform(cosY, shearY, shearX, cosX, 0, 0);
  }

  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-focusCanvasX, -focusCanvasY);

  // 4. Window Elevation Shadow + Clipping Shell
  drawWindowShadowAndShell(ctx, winX, winY, winW, winH, radius, style.shadowIntensity, refScale);

  ctx.save();
  roundRect(ctx, winX, winY, winW, winH, radius);
  ctx.clip();

  // 5. Window Chrome Header (macOS Sequoia Traffic Lights + Title)
  if (headerH > 0) {
    drawWindowChromeHeader(
      ctx,
      winX,
      winY,
      winW,
      headerH,
      style.windowChrome,
      style.windowTitle,
      refScale,
    );
  }

  // 6. Inner Application Viewport (Custom Video or Live Procedural Scene)
  const contentY = winY + headerH;
  const contentH = Math.max(40, winH - headerH);

  if (
    sourceVideo &&
    sourceVideo.readyState >= 2 &&
    sourceVideo.videoWidth > 0 &&
    sourceVideo.videoHeight > 0
  ) {
    ctx.fillStyle = '#07090E';
    ctx.fillRect(winX, contentY, winW, contentH);
    const vidAspect = sourceVideo.videoWidth / sourceVideo.videoHeight;
    const boxAspect = winW / contentH;
    let drawW = winW;
    let drawH = contentH;
    let drawX = winX;
    let drawY = contentY;
    if (vidAspect > boxAspect) {
      drawH = winW / vidAspect;
      drawY = contentY + (contentH - drawH) / 2;
    } else {
      drawW = contentH * vidAspect;
      drawX = winX + (winW - drawW) / 2;
    }
    ctx.drawImage(sourceVideo, drawX, drawY, drawW, drawH);
  } else {
    ctx.save();
    ctx.translate(winX, contentY);
    renderProceduralAppScene(ctx, project.scenePreset, winW, contentH, timeSec);
    ctx.restore();
  }

  // 7. Spotlight Focus Vignette (inside window)
  const activeSpotlight = findActiveSpotlight(project.spotlights, timeSec);
  if (style.spotlightEnabled || activeSpotlight) {
    const spotX = winX + (activeSpotlight ? activeSpotlight.x : cursor.x) * winW;
    const spotY = contentY + (activeSpotlight ? activeSpotlight.y : cursor.y) * contentH;
    const spotRadius =
      (activeSpotlight ? activeSpotlight.radius : 0.21) * Math.min(winW, winH);
    const dimAlpha = activeSpotlight
      ? Math.max(style.spotlightOpacity, 0.48)
      : style.spotlightOpacity;

    const spotGrad = ctx.createRadialGradient(
      spotX,
      spotY,
      spotRadius * 0.45,
      spotX,
      spotY,
      spotRadius * 1.85,
    );
    spotGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    spotGrad.addColorStop(0.55, `rgba(4, 6, 12, ${(dimAlpha * 0.35).toFixed(3)})`);
    spotGrad.addColorStop(1, `rgba(4, 6, 12, ${dimAlpha.toFixed(3)})`);
    ctx.fillStyle = spotGrad;
    ctx.fillRect(winX, contentY, winW, contentH);

    // Subtle luminous ring around spotlight focus
    ctx.beginPath();
    ctx.arc(spotX, spotY, spotRadius * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.42)';
    ctx.lineWidth = 1.5 * refScale;
    ctx.stroke();
  }

  // 8. Click Ripples + Motion-Blurred Cursor inside Window
  // Compensate cursor & ripple scale when camera is zoomed in so the pointer stays crisp and proportional
  const zoomCursorComp = 1 / Math.pow(Math.max(1, camera.scale), 0.42);
  const cursorCanvasX = winX + cursor.x * winW;
  const cursorCanvasY = contentY + cursor.y * contentH;

  if (style.clickRipple) {
    for (const ripple of cursor.activeRipples) {
      const rx = winX + ripple.x * winW;
      const ry = contentY + ripple.y * contentH;
      const easeOut = 1 - Math.pow(1 - ripple.progress, 3);
      const rRadius = (10 + easeOut * 34) * refScale * style.cursorScale * zoomCursorComp;
      const alpha = (1 - ripple.progress) * 0.68;

      ctx.beginPath();
      ctx.arc(rx, ry, rRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`;
      ctx.lineWidth = 2 * refScale * zoomCursorComp;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rx, ry, rRadius * 0.48, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(56, 189, 248, ${(alpha * 0.24).toFixed(3)})`;
      ctx.fill();
    }
  }

  drawCursorWithMotionBlur(
    ctx,
    cursorCanvasX,
    cursorCanvasY,
    cursor,
    style.cursorStyle,
    style.cursorScale * refScale * zoomCursorComp,
    style.motionBlur,
    winW,
    contentH,
  );

  // Optional target reticle when user is inspecting/editing a ZoomSegment
  if (showTargetReticle && selectedZoomId) {
    const sel = project.zoomSegments.find(z => z.id === selectedZoomId);
    if (sel) {
      const tx = winX + sel.targetX * winW;
      const ty = contentY + sel.targetY * contentH;
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.5 * refScale * zoomCursorComp;
      ctx.setLineDash([4 * refScale, 4 * refScale]);
      ctx.beginPath();
      ctx.arc(tx, ty, 20 * refScale * zoomCursorComp, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore(); // end window clip

  // 9. Crisp Outer Contact Rim + Specular 1px Inner Glass Rim on Window Shell
  roundRect(ctx, winX - 0.5, winY - 0.5, winW + 1, winH + 1, radius + 0.5);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.lineWidth = Math.max(1, refScale);
  ctx.stroke();

  if (style.insetBorder > 0) {
    roundRect(ctx, winX + 0.5, winY + 0.5, winW - 1, winH - 1, Math.max(1, radius - 0.5));
    ctx.strokeStyle = `rgba(255, 255, 255, ${((style.insetBorder / 100) * 0.26).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, 1.15 * refScale);
    ctx.stroke();
  }

  ctx.restore(); // end camera zoom + tilt transform

  // 10. Screen-Space Overlays (Spotlight Callout Pill, Keystroke HUD, Presenter PiP Bubble)
  if (activeSpotlight) {
    drawSpotlightCalloutCard(ctx, canvasWidth, canvasHeight, activeSpotlight, refScale);
  }

  const activeKeystroke = findActiveKeystroke(project.keystrokes, timeSec);
  if (activeKeystroke) {
    drawKeystrokeHudPill(ctx, canvasWidth, canvasHeight, activeKeystroke, timeSec, refScale);
  }

  if (style.webcamBubble.enabled) {
    drawWebcamBubble(
      ctx,
      canvasWidth,
      canvasHeight,
      style.webcamBubble,
      camera.scale,
      webcamVideo ?? null,
      refScale,
    );
  }

  // 11. Optional Split-Screen "Raw Capture vs Stagecraft Studio" Comparison Wipe
  if (
    typeof frameCtx.splitCompareRatio === 'number' &&
    frameCtx.splitCompareRatio > 0.02 &&
    frameCtx.splitCompareRatio < 0.98
  ) {
    const splitX = Math.round(canvasWidth * frameCtx.splitCompareRatio);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, canvasHeight);
    ctx.clip();

    // Flat unstyled raw capture on left half
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    if (
      sourceVideo &&
      sourceVideo.readyState >= 2 &&
      sourceVideo.videoWidth > 0 &&
      sourceVideo.videoHeight > 0
    ) {
      ctx.drawImage(sourceVideo, 0, 0, canvasWidth, canvasHeight);
    } else {
      renderProceduralAppScene(ctx, project.scenePreset, canvasWidth, canvasHeight, timeSec);
    }
    drawSingleCursorGlyph(
      ctx,
      cursor.x * canvasWidth,
      cursor.y * canvasHeight,
      'macos',
      1.0 * refScale,
      0.9,
    );
    ctx.restore();

    // Vertical comparison divider + handle + pills
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(2, 2.5 * refScale);
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, canvasHeight);
    ctx.stroke();

    // Center drag handle circle
    const cy = canvasHeight / 2;
    ctx.beginPath();
    ctx.arc(splitX, cy, 22 * refScale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2 * refScale;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.round(14 * refScale)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↔', splitX, cy);

    // Top-left "RAW CAPTURE" & Top-right "STAGECRAFT STUDIO" badges
    const badgeY = 24 * refScale;
    const badgeH = 32 * refScale;
    if (splitX > 180 * refScale) {
      roundRect(ctx, 24 * refScale, badgeY, 138 * refScale, badgeH, 8 * refScale);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fill();
      ctx.fillStyle = '#94A3B8';
      ctx.font = `700 ${Math.round(12 * refScale)}px -apple-system, sans-serif`;
      ctx.fillText('RAW CAPTURE', 93 * refScale, badgeY + badgeH / 2);
    }
    if (canvasWidth - splitX > 210 * refScale) {
      const bx = canvasWidth - 196 * refScale;
      roundRect(ctx, bx, badgeY, 172 * refScale, badgeH, 8 * refScale);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.88)';
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 ${Math.round(12 * refScale)}px -apple-system, sans-serif`;
      ctx.fillText('STAGECRAFT STUDIO', bx + 86 * refScale, badgeY + badgeH / 2);
    }
    ctx.restore();
  }

  ctx.restore();

  return {
    camera,
    cursor,
    activeKeystroke,
    activeSpotlight,
    windowRect: { x: winX, y: winY, w: winW, h: winH, headerH },
  };
}

function renderStudioBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  backdropId: string,
): void {
  const theme = getBackdropById(backdropId);
  const baseGrad = ctx.createLinearGradient(0, 0, w, h);
  baseGrad.addColorStop(0, theme.primaryStops[0]);
  baseGrad.addColorStop(0.52, theme.primaryStops[1]);
  baseGrad.addColorStop(1, theme.primaryStops[2]);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);

  for (const glow of theme.radialGlows) {
    const gx = glow.x * w;
    const gy = glow.y * h;
    const gr = glow.radius * Math.max(w, h);
    const rad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    rad.addColorStop(0, glow.color);
    rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);
  }

  // Subtle architectural vignette around outer studio frame
  const vig = ctx.createRadialGradient(
    w * 0.5,
    h * 0.5,
    Math.min(w, h) * 0.32,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.78,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function drawWindowShadowAndShell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  shadowIntensity: number,
  refScale: number,
): void {
  ctx.save();
  if (shadowIntensity > 0) {
    // Stage 1: Deep ambient dispersion shadow
    const ambientAlpha = (shadowIntensity / 100) * 0.58;
    ctx.shadowColor = `rgba(0, 0, 0, ${ambientAlpha.toFixed(3)})`;
    ctx.shadowBlur = (36 + (shadowIntensity / 100) * 64) * refScale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = (18 + (shadowIntensity / 100) * 26) * refScale;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = '#0D1017';
    ctx.fill();

    // Stage 2: Tighter grounding contact shadow
    const contactAlpha = (shadowIntensity / 100) * 0.36;
    ctx.shadowColor = `rgba(0, 0, 0, ${contactAlpha.toFixed(3)})`;
    ctx.shadowBlur = (10 + (shadowIntensity / 100) * 14) * refScale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = (4 + (shadowIntensity / 100) * 6) * refScale;
  }
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = '#0D1017';
  ctx.fill();
  ctx.restore();
}

function drawWindowChromeHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  headerH: number,
  chromeStyle: StagecraftProject['style']['windowChrome'],
  title: string,
  refScale: number,
): void {
  ctx.save();
  ctx.fillStyle =
    chromeStyle === 'macos-glass' ? 'rgba(22, 25, 34, 0.94)' : '#141720';
  ctx.fillRect(x, y, w, headerH);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = Math.max(1, refScale);
  ctx.beginPath();
  ctx.moveTo(x, y + headerH);
  ctx.lineTo(x + w, y + headerH);
  ctx.stroke();

  if (chromeStyle !== 'minimal') {
    const dots = [
      { fill: '#FF5F56', stroke: 'rgba(224, 68, 62, 0.8)' },
      { fill: '#FFBD2E', stroke: 'rgba(222, 161, 35, 0.8)' },
      { fill: '#27C93F', stroke: 'rgba(26, 171, 43, 0.8)' },
    ];
    const dotRadius = 6 * refScale;
    const startX = x + 20 * refScale;
    const centerY = y + headerH / 2;
    dots.forEach((dot, idx) => {
      ctx.beginPath();
      ctx.arc(startX + idx * 20 * refScale, centerY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = dot.fill;
      ctx.fill();
      ctx.strokeStyle = dot.stroke;
      ctx.lineWidth = Math.max(0.75, 0.8 * refScale);
      ctx.stroke();
    });
  }

  if (title) {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.font = `500 ${Math.max(10, Math.round(13 * refScale))}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x + w / 2, y + headerH / 2);
  }
  ctx.restore();
}

function drawCursorWithMotionBlur(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cursor: EvaluatedCursorState,
  style: StagecraftProject['style']['cursorStyle'],
  scale: number,
  motionBlurPct: number,
  winW: number,
  winH: number,
): void {
  // Smooth cosine click compression instead of binary step jump
  let pressScale = 1.0;
  if (cursor.activeRipples.length > 0) {
    const earliest = cursor.activeRipples[cursor.activeRipples.length - 1]!;
    if (earliest.progress < 0.28) {
      const u = earliest.progress / 0.28;
      pressScale = 1 - 0.13 * Math.sin(u * Math.PI);
    }
  } else if (cursor.isPressed) {
    pressScale = 0.9;
  }
  const effectiveScale = scale * pressScale;

  // Subtle directional velocity streak only during fast movements (no multi-cursor ghost trail)
  const pixelVx = cursor.vx * winW;
  const pixelVy = cursor.vy * winH;
  const pixelSpeed = Math.hypot(pixelVx, pixelVy);

  if (motionBlurPct > 10 && pixelSpeed > 380) {
    const streakLen = Math.min(36 * scale, pixelSpeed * 0.018 * (motionBlurPct / 100));
    const angle = Math.atan2(pixelVy, pixelVx);
    const tailX = cx - Math.cos(angle) * streakLen;
    const tailY = cy - Math.sin(angle) * streakLen;

    ctx.save();
    const grad = ctx.createLinearGradient(cx, cy, tailX, tailY);
    grad.addColorStop(0, `rgba(255, 255, 255, ${(0.22 * (motionBlurPct / 100)).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 6 * effectiveScale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 3 * effectiveScale, cy + 6 * effectiveScale);
    ctx.lineTo(tailX + 3 * effectiveScale, tailY + 6 * effectiveScale);
    ctx.stroke();
    ctx.restore();
  }

  drawSingleCursorGlyph(ctx, cx, cy, style, effectiveScale, 1.0);
}

function drawSingleCursorGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  style: StagecraftProject['style']['cursorStyle'],
  scale: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (style === 'touch-orb') {
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowColor = 'rgba(15, 23, 42, 0.55)';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#6366F1';
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (style === 'studio-ring') {
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#818CF8';
    ctx.fill();
    ctx.restore();
    return;
  }

  if (style === 'crosshair') {
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Default: Crisp macOS Sequoia Arrow Pointer
  ctx.shadowColor = 'rgba(0, 0, 0, 0.52)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 3;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 19.5);
  ctx.lineTo(4.6, 15.1);
  ctx.lineTo(8.1, 22.4);
  ctx.lineTo(10.9, 21.0);
  ctx.lineTo(7.4, 13.7);
  ctx.lineTo(13.6, 13.7);
  ctx.closePath();

  ctx.fillStyle = '#0F172A';
  ctx.fill();
  ctx.lineWidth = 1.9;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();

  ctx.restore();
}

function findActiveKeystroke(
  keystrokes: readonly KeystrokeEvent[],
  timeSec: number,
): KeystrokeEvent | null {
  for (const k of keystrokes) {
    if (timeSec >= k.time && timeSec <= k.time + k.duration) {
      return k;
    }
  }
  return null;
}

function findActiveSpotlight(
  spotlights: readonly SpotlightStep[],
  timeSec: number,
): SpotlightStep | null {
  for (const s of spotlights) {
    if (timeSec >= s.time && timeSec <= s.time + s.duration) {
      return s;
    }
  }
  return null;
}

function drawKeystrokeHudPill(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  ev: KeystrokeEvent,
  timeSec: number,
  refScale: number,
): void {
  const elapsed = timeSec - ev.time;
  const remaining = ev.time + ev.duration - timeSec;
  const entry = clamp(elapsed / 0.16, 0, 1);
  const exit = clamp(remaining / 0.18, 0, 1);
  const alpha = Math.min(entry, exit);
  const popScale = 0.92 + 0.08 * entry;

  ctx.save();
  ctx.globalAlpha = alpha;
  const centerX = canvasW / 2;
  const centerY = canvasH - 76 * refScale;
  ctx.translate(centerX, centerY);
  ctx.scale(popScale, popScale);

  const keyText = ev.keys;
  const subText = ev.label ? `  ${ev.label}` : '';
  ctx.font = `700 ${Math.round(20 * refScale)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
  const keyW = ctx.measureText(keyText).width;
  ctx.font = `500 ${Math.round(15 * refScale)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  const subW = subText ? ctx.measureText(subText).width : 0;

  const pillW = keyW + subW + 48 * refScale;
  const pillH = 48 * refScale;

  roundRect(ctx, -pillW / 2, -pillH / 2, pillW, pillH, 14 * refScale);
  ctx.fillStyle = 'rgba(12, 15, 24, 0.88)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 24 * refScale;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1.25 * refScale;
  ctx.stroke();

  // Inner keycap badge
  const capW = keyW + 20 * refScale;
  const capH = 32 * refScale;
  const capX = -pillW / 2 + 12 * refScale;
  roundRect(ctx, capX, -capH / 2, capW, capH, 8 * refScale);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fill();

  ctx.fillStyle = '#F8FAFC';
  ctx.font = `700 ${Math.round(18 * refScale)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(keyText, capX + 10 * refScale, 1 * refScale);

  if (subText) {
    ctx.fillStyle = '#CBD5E1';
    ctx.font = `500 ${Math.round(15 * refScale)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
    ctx.fillText(subText, capX + capW + 4 * refScale, 1 * refScale);
  }

  ctx.restore();
}

function drawSpotlightCalloutCard(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  step: SpotlightStep,
  refScale: number,
): void {
  ctx.save();
  const cardW = Math.min(canvasW * 0.42, 430 * refScale);
  const cardH = 82 * refScale;
  const x = 36 * refScale;
  const y = canvasH - cardH - 32 * refScale;

  roundRect(ctx, x, y, cardW, cardH, 14 * refScale);
  ctx.fillStyle = 'rgba(13, 17, 28, 0.90)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 22 * refScale;
  ctx.fill();

  ctx.strokeStyle = 'rgba(129, 140, 248, 0.42)';
  ctx.lineWidth = 1.25 * refScale;
  ctx.stroke();

  ctx.fillStyle = '#818CF8';
  ctx.font = `700 ${Math.round(15 * refScale)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.fillText(step.title, x + 18 * refScale, y + 28 * refScale);

  ctx.fillStyle = '#E2E8F0';
  ctx.font = `400 ${Math.round(13.5 * refScale)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.fillText(step.description, x + 18 * refScale, y + 54 * refScale, cardW - 36 * refScale);
  ctx.restore();
}

function drawWebcamBubble(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  config: StagecraftProject['style']['webcamBubble'],
  cameraScale: number,
  webcamVideo: HTMLVideoElement | null,
  refScale: number,
): void {
  const duckFactor = config.duckOnZoom && cameraScale > 1.35 ? 0.76 : 1.0;
  const size = config.size * refScale * duckFactor;
  const margin = 34 * refScale;

  let x = canvasW - size - margin;
  let y = canvasH - size - margin;
  if (config.position.includes('left')) x = margin;
  if (config.position.includes('top')) y = margin;

  ctx.save();
  ctx.globalAlpha = config.duckOnZoom && cameraScale > 1.35 ? 0.78 : 1.0;
  const r = config.shape === 'circle' ? size / 2 : size * 0.24;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 24 * refScale;
  roundRect(ctx, x, y, size, size, r);
  ctx.fillStyle = '#111827';
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, size, size, r);
  ctx.clip();

  if (webcamVideo && webcamVideo.readyState >= 2 && webcamVideo.videoWidth > 0) {
    ctx.drawImage(webcamVideo, x, y, size, size);
  } else {
    // Sleek studio presenter silhouette when camera hardware isn't active
    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, '#1E1B4B');
    grad.addColorStop(1, '#0F172A');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, size, size);

    ctx.fillStyle = 'rgba(129, 140, 248, 0.85)';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.4, size * 0.17, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.92, size * 0.34, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();

  roundRect(ctx, x, y, size, size, r);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 2 * refScale;
  ctx.stroke();
  ctx.restore();
}

/**
 * Maps a click in canvas pixel coordinates back into normalized [0..1] window coordinates,
 * inverting the active camera zoom & focus translation.
 */
export function canvasPixelToNormalizedWindowPoint(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
  camera: CameraFrameState,
  windowRect: { x: number; y: number; w: number; h: number; headerH: number },
): { x: number; y: number } {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const focusCanvasX = windowRect.x + camera.focusX * windowRect.w;
  const focusCanvasY = windowRect.y + camera.focusY * windowRect.h;

  const unscaledX = (canvasX - centerX) / camera.scale + focusCanvasX;
  const unscaledY = (canvasY - centerY) / camera.scale + focusCanvasY;

  const contentY = windowRect.y + windowRect.headerH;
  const contentH = Math.max(1, windowRect.h - windowRect.headerH);

  return {
    x: Number(clamp((unscaledX - windowRect.x) / windowRect.w, 0.04, 0.96).toFixed(3)),
    y: Number(clamp((unscaledY - contentY) / contentH, 0.04, 0.96).toFixed(3)),
  };
}
