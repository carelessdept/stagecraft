import type {
  AspectRatioPreset,
  CursorStylePreset,
  DemoScenePreset,
  SpringPresetName,
  StagecraftProject,
  WindowChromeStyle,
} from './state/types.js';
import {
  ASPECT_RATIO_DIMENSIONS,
  BACKDROP_THEMES,
  createPresetProject,
  getBackdropById,
} from './demo/presets.js';
import {
  SPRING_PRESETS,
  clamp,
  resolveSpringConfig,
  sampleSpringResponseCurve,
} from './engine/spring.js';
import { generateSmartZoomSegmentsFromClicks } from './engine/cursor.js';
import {
  ProjectHistoryStack,
  getPlaybackRateAtTime,
  insertZoomSegmentAtTime,
} from './engine/history.js';
import {
  type RenderedFrameDiagnostics,
  canvasPixelToNormalizedWindowPoint,
  renderCompositeFrame,
} from './engine/compositor.js';
import { StudioSoundEngine } from './engine/audio.js';
import { ScreenCaptureSession } from './engine/recorder.js';
import {
  exportCompositeVideo,
  generateInteractiveWalkthroughHtml,
  parseProjectJson,
  serializeProjectJson,
} from './engine/exporter.js';

type CanvasToolMode = 'inspect' | 'add-zoom' | 'add-spotlight';

// --- Modern Web Guidance Top-Layer Dialog Helpers ---
let supportsDisplayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

async function closeTopLayer(dialog: HTMLDialogElement): Promise<void> {
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map(a => a.finished)),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

function wireDialogLightDismissAndExit(dialog: HTMLDialogElement): void {
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    void closeTopLayer(dialog);
  });

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      void closeTopLayer(dialog);
    });
  }
}

// --- Main Studio Application ---
export function bootstrapStagecraftStudio(): void {
  const history = new ProjectHistoryStack(createPresetProject('code-deploy'));
  const soundEngine = new StudioSoundEngine();
  const screenRecorder = new ScreenCaptureSession();

  let currentTime = 0.0;
  let isPlaying = true;
  let loopPlayback = true;
  let playbackSpeedMultiplier = 1.0;
  let splitCompareRatio: number | null = null;
  let selectedZoomId: string | null = history.state.zoomSegments[0]?.id ?? null;
  let canvasTool: CanvasToolMode = 'inspect';
  let lastFrameNow = performance.now();
  let lastDiagnostics: RenderedFrameDiagnostics | null = null;

  let sourceVideoEl: HTMLVideoElement | null = null;
  let webcamVideoEl: HTMLVideoElement | null = null;

  // DOM Elements
  const studioCanvas = document.getElementById('studioCanvas') as HTMLCanvasElement;
  const ctx = studioCanvas.getContext('2d')!;
  const springCurveCanvas = document.getElementById('springCurveCanvas') as HTMLCanvasElement;
  const rulerCanvas = document.getElementById('rulerCanvas') as HTMLCanvasElement;

  const projectTitleInput = document.getElementById('projectTitleInput') as HTMLInputElement;
  const scenePresetSelect = document.getElementById('scenePresetSelect') as HTMLSelectElement;
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
  const recordScreenBtn = document.getElementById('recordScreenBtn') as HTMLButtonElement;
  const recordBtnLabel = document.getElementById('recordBtnLabel') as HTMLElement;
  const importVideoBtn = document.getElementById('importVideoBtn') as HTMLButtonElement;
  const videoFileInput = document.getElementById('videoFileInput') as HTMLInputElement;

  const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
  const stepBackBtn = document.getElementById('stepBackBtn') as HTMLButtonElement;
  const stepFwdBtn = document.getElementById('stepFwdBtn') as HTMLButtonElement;
  const loopToggleBtn = document.getElementById('loopToggleBtn') as HTMLButtonElement;
  const timecodeDisplay = document.getElementById('timecodeDisplay') as HTMLElement;

  const addZoomAtPlayheadBtn = document.getElementById('addZoomAtPlayheadBtn') as HTMLButtonElement;
  const autoZoomClicksBtn = document.getElementById('autoZoomClicksBtn') as HTMLButtonElement;
  const addKeystrokeBtn = document.getElementById('addKeystrokeBtn') as HTMLButtonElement;
  const addSpotlightBtn = document.getElementById('addSpotlightBtn') as HTMLButtonElement;
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn') as HTMLButtonElement;

  const hudZoomScale = document.getElementById('hudZoomScale') as HTMLElement;
  const hudCursorPos = document.getElementById('hudCursorPos') as HTMLElement;
  const hudSpringBadge = document.getElementById('hudSpringBadge') as HTMLElement;

  const laneVideo = document.getElementById('laneVideo') as HTMLElement;
  const laneZoom = document.getElementById('laneZoom') as HTMLElement;
  const laneClicks = document.getElementById('laneClicks') as HTMLElement;
  const laneHud = document.getElementById('laneHud') as HTMLElement;
  const playheadLine = document.getElementById('playheadLine') as HTMLElement;
  const timelineRuler = document.getElementById('timelineRuler') as HTMLElement;
  const timelineTracksContainer = document.getElementById('timelineTracksContainer') as HTMLElement;

  const exportDialog = document.getElementById('exportDialog') as HTMLDialogElement;
  const shortcutsDialog = document.getElementById('shortcutsDialog') as HTMLDialogElement;
  wireDialogLightDismissAndExit(exportDialog);
  wireDialogLightDismissAndExit(shortcutsDialog);

  function project(): StagecraftProject {
    return history.state;
  }

  function syncUndoRedoButtons(): void {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
    deleteSelectedBtn.disabled = !selectedZoomId;
  }

  function syncCanvasResolution(): void {
    const dims = ASPECT_RATIO_DIMENSIONS[project().style.aspectRatio];
    if (studioCanvas.width !== dims.width || studioCanvas.height !== dims.height) {
      studioCanvas.width = dims.width;
      studioCanvas.height = dims.height;
    }
  }

  // --- Inspector Population & Binding ---
  function renderBackdropCards(): void {
    const grid = document.getElementById('backdropGrid')!;
    grid.innerHTML = '';
    const activeId = project().style.backdropId;
    const activeTheme = getBackdropById(activeId);
    const labelEl = document.getElementById('activeBackdropLabel');
    if (labelEl) labelEl.textContent = activeTheme.name;

    for (const theme of BACKDROP_THEMES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `backdrop-card${theme.id === activeId ? ' active' : ''}`;
      const swatch = document.createElement('div');
      swatch.className = 'backdrop-swatch';
      swatch.style.background = `linear-gradient(135deg, ${theme.primaryStops[0]}, ${theme.primaryStops[1]}, ${theme.accentColor})`;

      const meta = document.createElement('div');
      meta.className = 'backdrop-meta';
      meta.innerHTML = `<div class="backdrop-title">${theme.name}</div><div class="backdrop-sub">${theme.subtitle}</div>`;

      card.append(swatch, meta);
      card.addEventListener('click', () => {
        const next = structuredClone(project());
        next.style.backdropId = theme.id;
        history.commit(next);
        syncAllUiFromState();
      });
      grid.appendChild(card);
    }
  }

  function renderSpringOscilloscope(): void {
    const sctx = springCurveCanvas.getContext('2d');
    if (!sctx) return;
    const w = springCurveCanvas.width;
    const h = springCurveCanvas.height;
    sctx.clearRect(0, 0, w, h);

    const cfg = resolveSpringConfig(project().style.springPreset, project().style.springConfig);
    const diag = sampleSpringResponseCurve(cfg, 1.0, 96);

    // Target line at y = 1.0
    const topPad = 34;
    const bottomPad = 24;
    const usableH = h - topPad - bottomPad;
    const targetY = topPad + usableH * 0.22;
    const baseY = h - bottomPad;

    sctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    sctx.setLineDash([4, 4]);
    sctx.lineWidth = 1.5;
    sctx.beginPath();
    sctx.moveTo(16, targetY);
    sctx.lineTo(w - 16, targetY);
    sctx.stroke();
    sctx.setLineDash([]);

    // Step Response Curve
    sctx.beginPath();
    const usableW = w - 32;
    diag.points.forEach((val, idx) => {
      const px = 16 + (idx / (diag.points.length - 1)) * usableW;
      const py = baseY - val * (baseY - targetY);
      if (idx === 0) sctx.moveTo(px, py);
      else sctx.lineTo(px, py);
    });
    sctx.strokeStyle = '#818CF8';
    sctx.lineWidth = 3;
    sctx.stroke();

    // Fill area under curve
    sctx.lineTo(16 + usableW, baseY);
    sctx.lineTo(16, baseY);
    sctx.closePath();
    const grad = sctx.createLinearGradient(0, targetY, 0, baseY);
    grad.addColorStop(0, 'rgba(99, 102, 241, 0.28)');
    grad.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
    sctx.fillStyle = grad;
    sctx.fill();

    // Diagnostics labels
    const regimeEl = document.getElementById('springRegimeBadge')!;
    regimeEl.textContent =
      diag.regime === 'underdamped'
        ? 'Underdamped'
        : diag.regime === 'critically-damped'
          ? 'Critically Damped'
          : 'Overdamped';

    document.getElementById('diagZeta')!.textContent = `ζ = ${diag.dampingRatio.toFixed(2)}`;
    document.getElementById('diagOvershoot')!.textContent = `Overshoot: +${diag.peakOvershootPct}%`;
    document.getElementById('diagSettling')!.textContent = `Settle: ${diag.settlingTimeMs} ms`;
    hudSpringBadge.textContent = `${project().style.springPreset.toUpperCase()} · ζ ${diag.dampingRatio.toFixed(2)}`;
  }

  function syncInspectorControls(): void {
    const st = project().style;
    projectTitleInput.value = project().name;

    // Aspect ratio buttons
    document.querySelectorAll<HTMLButtonElement>('#aspectRatioGroup .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.aspect === st.aspectRatio);
    });

    // Backdrop & Geometry
    renderBackdropCards();
    setSlider('sliderPadding', 'valPadding', st.padding, `${st.padding} px`);
    setSlider('sliderRadius', 'valRadius', st.cornerRadius, `${st.cornerRadius} px`);
    setSlider('sliderShadow', 'valShadow', st.shadowIntensity, `${st.shadowIntensity}%`);
    setSlider('sliderBorder', 'valBorder', st.insetBorder, `${st.insetBorder}%`);
    (document.getElementById('windowChromeSelect') as HTMLSelectElement).value = st.windowChrome;
    (document.getElementById('windowTitleInput') as HTMLInputElement).value = st.windowTitle;
    setSlider('sliderTiltX', 'valTiltX', st.tiltX, `${st.tiltX}°`);
    setSlider('sliderTiltY', 'valTiltY', st.tiltY, `${st.tiltY}°`);
    document.getElementById('toggleDynamicTilt')!.classList.toggle('active', st.dynamicTilt);

    // Selected Zoom Block
    const selZoom =
      project().zoomSegments.find(z => z.id === selectedZoomId) ??
      project().zoomSegments[0] ??
      null;
    const badgeEl = document.getElementById('selectedZoomBadge')!;
    const zoomScaleSlider = document.getElementById('sliderZoomScale') as HTMLInputElement;
    const zoomModeSelect = document.getElementById('zoomModeSelect') as HTMLSelectElement;
    if (selZoom) {
      badgeEl.textContent = selZoom.label ?? selZoom.id;
      zoomScaleSlider.disabled = false;
      zoomModeSelect.disabled = false;
      setSlider('sliderZoomScale', 'valZoomScale', selZoom.scale, `${selZoom.scale.toFixed(2)}×`);
      zoomModeSelect.value = selZoom.mode;
      document.getElementById('valZoomTarget')!.textContent =
        `${selZoom.targetX.toFixed(2)}, ${selZoom.targetY.toFixed(2)}`;
    } else {
      badgeEl.textContent = 'None';
      zoomScaleSlider.disabled = true;
      zoomModeSelect.disabled = true;
    }

    // Spring Preset & Sliders
    document.querySelectorAll<HTMLButtonElement>('#springPresetGroup .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.spring === st.springPreset);
    });
    const resolvedSpring = resolveSpringConfig(st.springPreset, st.springConfig);
    setSlider('sliderStiffness', 'valStiffness', resolvedSpring.stiffness, `${Math.round(resolvedSpring.stiffness)}`);
    setSlider('sliderDamping', 'valDamping', resolvedSpring.damping, `${Math.round(resolvedSpring.damping)}`);
    setSlider('sliderMass', 'valMass', resolvedSpring.mass, resolvedSpring.mass.toFixed(2));
    renderSpringOscilloscope();

    // Cursor & Motion Blur
    (document.getElementById('cursorStyleSelect') as HTMLSelectElement).value = st.cursorStyle;
    setSlider('sliderCursorScale', 'valCursorScale', st.cursorScale, `${st.cursorScale.toFixed(2)}×`);
    setSlider('sliderSmoothing', 'valSmoothing', st.cursorSmoothing, `${st.cursorSmoothing}%`);
    setSlider('sliderMotionBlur', 'valMotionBlur', st.motionBlur, `${st.motionBlur}%`);
    document.getElementById('toggleClickRipple')!.classList.toggle('active', st.clickRipple);
    document.getElementById('toggleClickSound')!.classList.toggle('active', st.clickSound);
    document.getElementById('toggleSpotlight')!.classList.toggle('active', st.spotlightEnabled);
    setSlider(
      'sliderSpotlightOpacity',
      'valSpotlightOpacity',
      Math.round(st.spotlightOpacity * 100),
      `${Math.round(st.spotlightOpacity * 100)}%`,
    );

    // Overlays & Webcam PiP
    document.getElementById('toggleWebcamBubble')!.classList.toggle('active', st.webcamBubble.enabled);
    (document.getElementById('webcamPositionSelect') as HTMLSelectElement).value = st.webcamBubble.position;
    (document.getElementById('webcamShapeSelect') as HTMLSelectElement).value = st.webcamBubble.shape;
    document.getElementById('toggleWebcamDuck')!.classList.toggle('active', st.webcamBubble.duckOnZoom);
  }

  function setSlider(sliderId: string, labelId: string, val: number, text: string): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const label = document.getElementById(labelId);
    if (slider) slider.value = String(val);
    if (label) label.textContent = text;
  }

  // --- Multi-Track Timeline Renderer & Interactive Dragging ---
  function renderTimeline(): void {
    const dur = Math.max(1, project().duration);

    // 1. Ruler Ticks
    const rect = timelineRuler.getBoundingClientRect();
    if (rect.width > 0 && rulerCanvas.width !== Math.round(rect.width * 2)) {
      rulerCanvas.width = Math.round(rect.width * 2);
      rulerCanvas.height = 60;
    }
    const rctx = rulerCanvas.getContext('2d');
    if (rctx) {
      const rw = rulerCanvas.width;
      const rh = rulerCanvas.height;
      rctx.clearRect(0, 0, rw, rh);
      rctx.fillStyle = '#64748B';
      rctx.font = '600 20px "SF Mono", monospace';
      const stepSec = dur <= 12 ? 1 : dur <= 30 ? 2 : 5;
      for (let s = 0; s <= dur; s += stepSec * 0.25) {
        const x = (s / dur) * rw;
        const isMajor = Math.abs(s % stepSec) < 0.001;
        rctx.fillStyle = isMajor ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)';
        rctx.fillRect(x, isMajor ? rh * 0.42 : rh * 0.68, 2, rh);
        if (isMajor) {
          rctx.fillStyle = '#94A3B8';
          rctx.fillText(`${s.toFixed(0)}s`, x + 6, rh * 0.36);
        }
      }
    }

    // 2. Track 1: Screen Video Clip
    laneVideo.innerHTML = '';
    const vClip = document.createElement('div');
    vClip.className = 'clip-block video-clip';
    vClip.style.left = `${(project().trimStart / dur) * 100}%`;
    vClip.style.width = `${((project().trimEnd - project().trimStart) / dur) * 100}%`;
    vClip.textContent =
      project().scenePreset === 'custom-video'
        ? `Recorded / Imported Video (${dur.toFixed(1)}s)`
        : `${project().name} · 60fps Composite`;
    laneVideo.appendChild(vClip);

    // 3. Track 2: Interactive Spring Zoom Segments
    laneZoom.innerHTML = '';
    for (const seg of project().zoomSegments) {
      const block = document.createElement('div');
      block.className = `clip-block zoom-clip${seg.id === selectedZoomId ? ' selected' : ''}`;
      block.style.left = `${(seg.startTime / dur) * 100}%`;
      block.style.width = `${Math.max(2, ((seg.endTime - seg.startTime) / dur) * 100)}%`;
      block.textContent = `${seg.scale.toFixed(2)}× ${seg.label ?? 'Zoom'}`;

      const leftHandle = document.createElement('div');
      leftHandle.className = 'zoom-handle left';
      const rightHandle = document.createElement('div');
      rightHandle.className = 'zoom-handle right';
      block.append(leftHandle, rightHandle);

      block.addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        selectedZoomId = seg.id;
        syncAllUiFromState();

        const laneRect = laneZoom.getBoundingClientRect();
        const startClientX = ev.clientX;
        const origStart = seg.startTime;
        const origEnd = seg.endTime;
        const mode: 'move' | 'left' | 'right' =
          ev.target === leftHandle ? 'left' : ev.target === rightHandle ? 'right' : 'move';

        history.markCheckpoint();

        const onMove = (me: PointerEvent) => {
          const deltaSec = ((me.clientX - startClientX) / Math.max(1, laneRect.width)) * dur;
          const next = structuredClone(project());
          const target = next.zoomSegments.find(z => z.id === seg.id);
          if (!target) return;

          if (mode === 'move') {
            const len = origEnd - origStart;
            const ns = clamp(origStart + deltaSec, 0, dur - len);
            target.startTime = Number(ns.toFixed(2));
            target.endTime = Number((ns + len).toFixed(2));
          } else if (mode === 'left') {
            target.startTime = Number(clamp(origStart + deltaSec, 0, origEnd - 0.35).toFixed(2));
          } else {
            target.endTime = Number(clamp(origEnd + deltaSec, origStart + 0.35, dur).toFixed(2));
          }
          history.replaceCurrent(next);
          renderTimeline();
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          syncAllUiFromState();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      laneZoom.appendChild(block);
    }

    // 4. Track 3: Click Markers
    laneClicks.innerHTML = '';
    project()
      .cursorTrack.filter(c => c.clicked)
      .forEach(pt => {
        const marker = document.createElement('div');
        marker.className = 'click-marker';
        marker.style.left = `${(pt.time / dur) * 100}%`;
        marker.title = `${pt.label ?? 'Click'} at ${pt.time.toFixed(2)}s`;
        marker.addEventListener('click', ev => {
          ev.stopPropagation();
          currentTime = pt.time;
          isPlaying = false;
          syncPlayPauseButton();
        });
        laneClicks.appendChild(marker);
      });

    // 5. Track 4: Keystroke HUD & Spotlight Steps
    laneHud.innerHTML = '';
    for (const k of project().keystrokes) {
      const pill = document.createElement('div');
      pill.className = 'hud-pill-marker key-marker';
      pill.style.left = `${(k.time / dur) * 100}%`;
      pill.style.width = `${Math.max(3, (k.duration / dur) * 100)}%`;
      pill.textContent = `⌨ ${k.keys}`;
      pill.title = `${k.keys} (${k.label ?? ''}) · Click to jump, Alt+Click to delete`;
      pill.addEventListener('click', ev => {
        ev.stopPropagation();
        if (ev.altKey) {
          const next = structuredClone(project());
          next.keystrokes = next.keystrokes.filter(item => item.id !== k.id);
          history.commit(next);
          syncAllUiFromState();
        } else {
          currentTime = k.time + 0.1;
          isPlaying = false;
          syncPlayPauseButton();
        }
      });
      laneHud.appendChild(pill);
    }

    for (const s of project().spotlights) {
      const pill = document.createElement('div');
      pill.className = 'hud-pill-marker spot-marker';
      pill.style.left = `${(s.time / dur) * 100}%`;
      pill.style.width = `${Math.max(4, (s.duration / dur) * 100)}%`;
      pill.textContent = `✦ ${s.title}`;
      pill.title = `${s.title} · Click to jump, Alt+Click to delete`;
      pill.addEventListener('click', ev => {
        ev.stopPropagation();
        if (ev.altKey) {
          const next = structuredClone(project());
          next.spotlights = next.spotlights.filter(item => item.id !== s.id);
          history.commit(next);
          syncAllUiFromState();
        } else {
          currentTime = s.time + 0.15;
          isPlaying = false;
          syncPlayPauseButton();
        }
      });
      laneHud.appendChild(pill);
    }
  }

  function updatePlayheadPositionUi(): void {
    const dur = Math.max(0.1, project().duration);
    const laneRect = laneZoom.getBoundingClientRect();
    const containerRect = timelineTracksContainer.getBoundingClientRect();
    const offsetLeft = laneRect.left - containerRect.left;
    const x = offsetLeft + (currentTime / dur) * laneRect.width;
    playheadLine.style.left = `${x}px`;

    timecodeDisplay.innerHTML = `${formatTimecode(currentTime)} <span>/ ${formatTimecode(dur)}</span>`;
  }

  function syncPlayPauseButton(): void {
    playPauseBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
  }

  function syncAllUiFromState(): void {
    syncCanvasResolution();
    syncUndoRedoButtons();
    syncInspectorControls();
    renderTimeline();
    updatePlayheadPositionUi();
  }

  // --- Scrubbing on Timeline Ruler & Lanes ---
  function bindTimelineScrubbing(element: HTMLElement): void {
    element.addEventListener('pointerdown', ev => {
      if ((ev.target as HTMLElement).closest('.clip-block, .click-marker, .hud-pill-marker')) {
        return;
      }
      isPlaying = false;
      syncPlayPauseButton();
      const scrub = (clientX: number) => {
        const rect = laneZoom.getBoundingClientRect();
        const u = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        currentTime = u * project().duration;
        if (sourceVideoEl && sourceVideoEl.readyState >= 2) {
          sourceVideoEl.currentTime = Math.min(sourceVideoEl.duration || currentTime, currentTime);
        }
        updatePlayheadPositionUi();
      };
      scrub(ev.clientX);
      const onMove = (me: PointerEvent) => scrub(me.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  bindTimelineScrubbing(timelineRuler);
  bindTimelineScrubbing(timelineTracksContainer);

  // --- Canvas Direct Interaction (Split Wipe / Focus Target / Click-to-Zoom / Click-to-Spotlight) ---
  studioCanvas.addEventListener('pointerdown', ev => {
    if (!lastDiagnostics) return;
    const rect = studioCanvas.getBoundingClientRect();

    if (splitCompareRatio !== null) {
      const updateSplit = (clientX: number) => {
        splitCompareRatio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0.05, 0.95);
      };
      updateSplit(ev.clientX);
      const onMove = (me: PointerEvent) => updateSplit(me.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    const canvasX = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * studioCanvas.width;
    const canvasY = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * studioCanvas.height;

    const norm = canvasPixelToNormalizedWindowPoint(
      canvasX,
      canvasY,
      studioCanvas.width,
      studioCanvas.height,
      lastDiagnostics.camera,
      lastDiagnostics.windowRect,
    );

    if (canvasTool === 'add-zoom') {
      const next = structuredClone(project());
      const { segments, created } = insertZoomSegmentAtTime(
        next.zoomSegments,
        next.duration,
        currentTime,
        {
          scale: 2.25,
          targetX: norm.x,
          targetY: norm.y,
          mode: 'manual',
          springPreset: next.style.springPreset,
          label: `Focus (${norm.x.toFixed(2)}, ${norm.y.toFixed(2)})`,
        },
      );
      next.zoomSegments = segments;
      selectedZoomId = created.id;
      history.commit(next);
      syncAllUiFromState();
      return;
    }

    if (canvasTool === 'add-spotlight') {
      const next = structuredClone(project());
      next.spotlights.push({
        id: `spot-${Date.now().toString(36)}`,
        time: Number(currentTime.toFixed(2)),
        duration: 2.0,
        x: norm.x,
        y: norm.y,
        radius: 0.2,
        title: `Step ${next.spotlights.length + 1}: Highlighted Action`,
        description: `Focuses viewer attention at (${norm.x.toFixed(2)}, ${norm.y.toFixed(2)}).`,
      });
      history.commit(next);
      syncAllUiFromState();
      return;
    }

    // Default 'inspect' mode: update selected zoom block's target coordinate
    if (selectedZoomId) {
      const next = structuredClone(project());
      const target = next.zoomSegments.find(z => z.id === selectedZoomId);
      if (target) {
        target.targetX = norm.x;
        target.targetY = norm.y;
        history.commit(next);
        syncAllUiFromState();
      }
    }
  });

  // --- Wire Topbar, Transport, and Inspector Events ---
  document.querySelectorAll<HTMLButtonElement>('.inspector-tabs .insp-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.inspector-tabs .insp-tab').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      const tabName = tabBtn.dataset.tab!;
      ['backdrop', 'spring', 'cursor', 'overlays'].forEach(name => {
        const panel = document.getElementById(`tab-${name}`)!;
        panel.style.display = name === tabName ? 'flex' : 'none';
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('#canvasToolGroup .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#canvasToolGroup .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      canvasTool = (btn.dataset.tool as CanvasToolMode) || 'inspect';
    });
  });

  document.querySelectorAll<HTMLButtonElement>('#aspectRatioGroup .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const aspect = btn.dataset.aspect as AspectRatioPreset;
      const next = structuredClone(project());
      next.style.aspectRatio = aspect;
      history.commit(next);
      syncAllUiFromState();
    });
  });

  projectTitleInput.addEventListener('change', () => {
    const next = structuredClone(project());
    next.name = projectTitleInput.value.trim() || 'Untitled Stagecraft Demo';
    history.commit(next);
    syncAllUiFromState();
  });

  scenePresetSelect.addEventListener('change', () => {
    const preset = scenePresetSelect.value as DemoScenePreset;
    sourceVideoEl = null;
    const loaded = createPresetProject(preset);
    history.reset(loaded);
    selectedZoomId = loaded.zoomSegments[0]?.id ?? null;
    currentTime = 0;
    syncAllUiFromState();
  });

  undoBtn.addEventListener('click', () => {
    if (history.undo()) syncAllUiFromState();
  });

  redoBtn.addEventListener('click', () => {
    if (history.redo()) syncAllUiFromState();
  });

  playPauseBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    if (isPlaying && currentTime >= project().duration - 0.05) {
      currentTime = 0;
    }
    if (sourceVideoEl) {
      if (isPlaying) void sourceVideoEl.play().catch(() => {});
      else sourceVideoEl.pause();
    }
    syncPlayPauseButton();
  });

  stepBackBtn.addEventListener('click', () => {
    isPlaying = false;
    currentTime = Math.max(0, currentTime - 0.1);
    syncPlayPauseButton();
    updatePlayheadPositionUi();
  });

  stepFwdBtn.addEventListener('click', () => {
    isPlaying = false;
    currentTime = Math.min(project().duration, currentTime + 0.1);
    syncPlayPauseButton();
    updatePlayheadPositionUi();
  });

  loopToggleBtn.addEventListener('click', () => {
    loopPlayback = !loopPlayback;
    loopToggleBtn.textContent = `↻ Loop: ${loopPlayback ? 'On' : 'Off'}`;
  });

  function insertZoomAtPlayhead(): void {
    const next = structuredClone(project());
    const cursorPos = lastDiagnostics?.cursor ?? { x: 0.5, y: 0.5 };
    const { segments, created } = insertZoomSegmentAtTime(
      next.zoomSegments,
      next.duration,
      currentTime,
      {
        scale: 2.2,
        targetX: Number(cursorPos.x.toFixed(3)),
        targetY: Number(cursorPos.y.toFixed(3)),
        mode: 'auto-cursor',
        springPreset: next.style.springPreset,
      },
    );
    next.zoomSegments = segments;
    selectedZoomId = created.id;
    history.commit(next);
    syncAllUiFromState();
  }

  function insertKeystrokeAtPlayhead(keys = '⌘ K', label = 'Command Palette'): void {
    const next = structuredClone(project());
    next.keystrokes.push({
      id: `key-${Date.now().toString(36)}`,
      time: Number(currentTime.toFixed(2)),
      duration: 1.5,
      keys,
      label,
    });
    history.commit(next);
    syncAllUiFromState();
  }

  function insertSpotlightAtPlayhead(): void {
    const next = structuredClone(project());
    const cursorPos = lastDiagnostics?.cursor ?? { x: 0.5, y: 0.5 };
    next.spotlights.push({
      id: `spot-${Date.now().toString(36)}`,
      time: Number(currentTime.toFixed(2)),
      duration: 2.0,
      x: Number(cursorPos.x.toFixed(3)),
      y: Number(cursorPos.y.toFixed(3)),
      radius: 0.21,
      title: `Step ${next.spotlights.length + 1}: Guided Focus`,
      description: 'Highlights the active workflow step for interactive walkthrough exports.',
    });
    history.commit(next);
    syncAllUiFromState();
  }

  function deleteSelectedZoomBlock(): void {
    if (!selectedZoomId) return;
    const next = structuredClone(project());
    next.zoomSegments = next.zoomSegments.filter(z => z.id !== selectedZoomId);
    selectedZoomId = next.zoomSegments[0]?.id ?? null;
    history.commit(next);
    syncAllUiFromState();
  }

  addZoomAtPlayheadBtn.addEventListener('click', insertZoomAtPlayhead);

  autoZoomClicksBtn.addEventListener('click', () => {
    const next = structuredClone(project());
    next.zoomSegments = generateSmartZoomSegmentsFromClicks(
      next.cursorTrack,
      next.duration,
      2.2,
      next.style.springPreset,
    );
    selectedZoomId = next.zoomSegments[0]?.id ?? null;
    history.commit(next);
    syncAllUiFromState();
  });

  addKeystrokeBtn.addEventListener('click', () => insertKeystrokeAtPlayhead('⌘ K', 'Quick Action'));
  addSpotlightBtn.addEventListener('click', insertSpotlightAtPlayhead);
  deleteSelectedBtn.addEventListener('click', deleteSelectedZoomBlock);

  document.getElementById('insertKeystrokeCustomBtn')!.addEventListener('click', () => {
    const keys = (document.getElementById('newKeystrokeKeys') as HTMLInputElement).value.trim() || '⌘ K';
    const label = (document.getElementById('newKeystrokeLabel') as HTMLInputElement).value.trim() || 'Shortcut';
    insertKeystrokeAtPlayhead(keys, label);
  });

  // --- Slider & Switch Helpers ---
  function bindStyleRange<K extends keyof StagecraftProject['style']>(
    sliderId: string,
    key: K,
    transform: (raw: number) => StagecraftProject['style'][K],
  ): void {
    const el = document.getElementById(sliderId) as HTMLInputElement;
    el.addEventListener('pointerdown', () => history.markCheckpoint());
    el.addEventListener('input', () => {
      const next = structuredClone(project());
      next.style[key] = transform(Number(el.value));
      history.replaceCurrent(next);
      syncInspectorControls();
    });
  }

  bindStyleRange('sliderPadding', 'padding', v => v);
  bindStyleRange('sliderRadius', 'cornerRadius', v => v);
  bindStyleRange('sliderShadow', 'shadowIntensity', v => v);
  bindStyleRange('sliderBorder', 'insetBorder', v => v);
  bindStyleRange('sliderTiltX', 'tiltX', v => v);
  bindStyleRange('sliderTiltY', 'tiltY', v => v);
  bindStyleRange('sliderCursorScale', 'cursorScale', v => v);
  bindStyleRange('sliderSmoothing', 'cursorSmoothing', v => v);
  bindStyleRange('sliderMotionBlur', 'motionBlur', v => v);
  bindStyleRange('sliderSpotlightOpacity', 'spotlightOpacity', v => Number((v / 100).toFixed(2)));

  (document.getElementById('windowChromeSelect') as HTMLSelectElement).addEventListener('change', e => {
    const next = structuredClone(project());
    next.style.windowChrome = (e.target as HTMLSelectElement).value as WindowChromeStyle;
    history.commit(next);
    syncAllUiFromState();
  });

  (document.getElementById('windowTitleInput') as HTMLInputElement).addEventListener('input', e => {
    const next = structuredClone(project());
    next.style.windowTitle = (e.target as HTMLInputElement).value;
    history.replaceCurrent(next);
  });

  (document.getElementById('cursorStyleSelect') as HTMLSelectElement).addEventListener('change', e => {
    const next = structuredClone(project());
    next.style.cursorStyle = (e.target as HTMLSelectElement).value as CursorStylePreset;
    history.commit(next);
    syncAllUiFromState();
  });

  function bindSwitch(btnId: string, toggleFn: (next: StagecraftProject) => void): void {
    document.getElementById(btnId)!.addEventListener('click', () => {
      const next = structuredClone(project());
      toggleFn(next);
      history.commit(next);
      syncAllUiFromState();
    });
  }

  bindSwitch('toggleDynamicTilt', n => {
    n.style.dynamicTilt = !n.style.dynamicTilt;
  });
  bindSwitch('toggleClickRipple', n => {
    n.style.clickRipple = !n.style.clickRipple;
  });
  bindSwitch('toggleClickSound', n => {
    n.style.clickSound = !n.style.clickSound;
  });
  bindSwitch('toggleSpotlight', n => {
    n.style.spotlightEnabled = !n.style.spotlightEnabled;
  });
  bindSwitch('toggleWebcamBubble', n => {
    n.style.webcamBubble.enabled = !n.style.webcamBubble.enabled;
  });
  bindSwitch('toggleWebcamDuck', n => {
    n.style.webcamBubble.duckOnZoom = !n.style.webcamBubble.duckOnZoom;
  });

  (document.getElementById('webcamPositionSelect') as HTMLSelectElement).addEventListener('change', e => {
    const next = structuredClone(project());
    next.style.webcamBubble.position = (e.target as HTMLSelectElement)
      .value as StagecraftProject['style']['webcamBubble']['position'];
    history.commit(next);
    syncAllUiFromState();
  });

  (document.getElementById('webcamShapeSelect') as HTMLSelectElement).addEventListener('change', e => {
    const next = structuredClone(project());
    next.style.webcamBubble.shape = (e.target as HTMLSelectElement)
      .value as StagecraftProject['style']['webcamBubble']['shape'];
    history.commit(next);
    syncAllUiFromState();
  });

  document.getElementById('connectWebcamHardwareBtn')!.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 480 },
        audio: false,
      });
      webcamVideoEl = document.createElement('video');
      webcamVideoEl.srcObject = stream;
      webcamVideoEl.muted = true;
      webcamVideoEl.playsInline = true;
      await webcamVideoEl.play();
      const next = structuredClone(project());
      next.style.webcamBubble.enabled = true;
      history.commit(next);
      syncAllUiFromState();
    } catch {
      const next = structuredClone(project());
      next.style.webcamBubble.enabled = true;
      history.commit(next);
      syncAllUiFromState();
    }
  });

  // Selected Zoom Scale & Mode
  const sliderZoomScale = document.getElementById('sliderZoomScale') as HTMLInputElement;
  sliderZoomScale.addEventListener('pointerdown', () => history.markCheckpoint());
  sliderZoomScale.addEventListener('input', () => {
    if (!selectedZoomId) return;
    const next = structuredClone(project());
    const seg = next.zoomSegments.find(z => z.id === selectedZoomId);
    if (!seg) return;
    seg.scale = Number(sliderZoomScale.value);
    history.replaceCurrent(next);
    syncInspectorControls();
    renderTimeline();
  });

  (document.getElementById('zoomModeSelect') as HTMLSelectElement).addEventListener('change', e => {
    if (!selectedZoomId) return;
    const next = structuredClone(project());
    const seg = next.zoomSegments.find(z => z.id === selectedZoomId);
    if (!seg) return;
    seg.mode = (e.target as HTMLSelectElement).value as 'auto-cursor' | 'manual';
    history.commit(next);
    syncAllUiFromState();
  });

  // Spring Preset & Custom Sliders
  document.querySelectorAll<HTMLButtonElement>('#springPresetGroup .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.spring as Exclude<SpringPresetName, 'custom'>;
      const next = structuredClone(project());
      next.style.springPreset = preset;
      next.style.springConfig = { ...SPRING_PRESETS[preset] };
      if (selectedZoomId) {
        const seg = next.zoomSegments.find(z => z.id === selectedZoomId);
        if (seg) seg.springPreset = preset;
      }
      history.commit(next);
      syncAllUiFromState();
    });
  });

  function bindSpringParam(sliderId: string, param: 'stiffness' | 'damping' | 'mass'): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    slider.addEventListener('pointerdown', () => history.markCheckpoint());
    slider.addEventListener('input', () => {
      const next = structuredClone(project());
      next.style.springPreset = 'custom';
      next.style.springConfig[param] = Number(slider.value);
      history.replaceCurrent(next);
      syncInspectorControls();
    });
  }

  bindSpringParam('sliderStiffness', 'stiffness');
  bindSpringParam('sliderDamping', 'damping');
  bindSpringParam('sliderMass', 'mass');

  // --- Screen Capture & Video Import ---
  recordScreenBtn.addEventListener('click', async () => {
    if (screenRecorder.isRecording) {
      screenRecorder.stop();
      return;
    }
    try {
      await screenRecorder.start(result => {
        recordScreenBtn.classList.remove('is-recording');
        recordBtnLabel.textContent = 'Record Screen';
        loadExternalVideoSource(result.videoUrl, 'Screen Capture · Studio Master', {
          duration: result.duration,
          cursorTrack: result.cursorTrack,
          keystrokes: result.keystrokes,
          zoomSegments: result.zoomSegments,
        });
      });
      recordScreenBtn.classList.add('is-recording');
      recordBtnLabel.textContent = 'Stop Recording';
    } catch {
      recordScreenBtn.classList.remove('is-recording');
      recordBtnLabel.textContent = 'Record Screen';
    }
  });

  importVideoBtn.addEventListener('click', () => videoFileInput.click());
  videoFileInput.addEventListener('change', () => {
    const file = videoFileInput.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      loadExternalVideoSource(url, file.name.replace(/\.[^.]+$/, ''));
    }
  });

  function loadExternalVideoSource(
    url: string,
    title: string,
    capturedData?: Partial<StagecraftProject>,
  ): void {
    const vid = document.createElement('video');
    vid.src = url;
    vid.muted = true;
    vid.playsInline = true;
    vid.crossOrigin = 'anonymous';
    vid.addEventListener('loadedmetadata', () => {
      const dur = Number(clamp(vid.duration || capturedData?.duration || 8.0, 1.5, 180).toFixed(2));
      sourceVideoEl = vid;
      const next = structuredClone(project());
      next.name = title;
      next.scenePreset = 'custom-video';
      next.duration = dur;
      next.trimStart = 0;
      next.trimEnd = dur;
      if (capturedData?.cursorTrack) next.cursorTrack = capturedData.cursorTrack;
      if (capturedData?.keystrokes) next.keystrokes = capturedData.keystrokes;
      if (capturedData?.zoomSegments && capturedData.zoomSegments.length > 0) {
        next.zoomSegments = capturedData.zoomSegments;
      }
      selectedZoomId = next.zoomSegments[0]?.id ?? null;
      currentTime = 0;
      history.reset(next);
      syncAllUiFromState();
      void vid.play().catch(() => {});
    });
  }

  // Drag & Drop Video or JSON Project
  const stageDropZone = document.getElementById('stageDropZone')!;
  const dropOverlay = document.getElementById('dropOverlay')!;
  stageDropZone.addEventListener('dragover', ev => {
    ev.preventDefault();
    dropOverlay.classList.add('active');
  });
  stageDropZone.addEventListener('dragleave', ev => {
    if (ev.target === dropOverlay) {
      dropOverlay.classList.remove('active');
    }
  });
  stageDropZone.addEventListener('drop', async ev => {
    ev.preventDefault();
    dropOverlay.classList.remove('active');
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.json')) {
      const text = await file.text();
      const loaded = parseProjectJson(text);
      sourceVideoEl = null;
      history.reset(loaded);
      selectedZoomId = loaded.zoomSegments[0]?.id ?? null;
      currentTime = 0;
      syncAllUiFromState();
    } else if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      loadExternalVideoSource(url, file.name.replace(/\.[^.]+$/, ''));
    }
  });

  // --- Dialogs & Export Actions ---
  document.getElementById('openExportDialogBtn')!.addEventListener('click', () => {
    isPlaying = false;
    syncPlayPauseButton();
    exportDialog.showModal();
  });

  document.getElementById('closeExportDialogBtn')!.addEventListener('click', () => {
    void closeTopLayer(exportDialog);
  });

  document.getElementById('shortcutsBtn')!.addEventListener('click', () => {
    shortcutsDialog.showModal();
  });

  document.getElementById('closeShortcutsDialogBtn')!.addEventListener('click', () => {
    void closeTopLayer(shortcutsDialog);
  });

  const compareSplitBtn = document.getElementById('compareSplitBtn') as HTMLButtonElement;
  function toggleSplitCompare(): void {
    splitCompareRatio = splitCompareRatio === null ? 0.48 : null;
    compareSplitBtn.classList.toggle('btn-primary', splitCompareRatio !== null);
  }
  compareSplitBtn.addEventListener('click', toggleSplitCompare);

  const playbackSpeedSelect = document.getElementById('playbackSpeedSelect') as HTMLSelectElement;
  playbackSpeedSelect.addEventListener('change', () => {
    playbackSpeedMultiplier = Number(playbackSpeedSelect.value) || 1.0;
  });

  function exportCurrentPngFrame(): void {
    studioCanvas.toBlob(blob => {
      if (blob) {
        triggerDownload(blob, `${slugify(project().name)}-frame-${currentTime.toFixed(1)}s.png`);
      }
    }, 'image/png');
  }

  document.getElementById('exportPngFrameBtn')!.addEventListener('click', exportCurrentPngFrame);

  document.getElementById('exportArcadeBtn')!.addEventListener('click', () => {
    const html = generateInteractiveWalkthroughHtml(project());
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    triggerDownload(blob, `${slugify(project().name)}-walkthrough.html`);
  });

  document.getElementById('exportJsonBtn')!.addEventListener('click', () => {
    const json = serializeProjectJson(project());
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    triggerDownload(blob, `${slugify(project().name)}.stagecraft.json`);
  });

  const projectJsonInput = document.getElementById('projectJsonInput') as HTMLInputElement;
  document.getElementById('loadProjectJsonBtn')!.addEventListener('click', () => {
    projectJsonInput.click();
  });
  projectJsonInput.addEventListener('change', async () => {
    const file = projectJsonInput.files?.[0];
    if (!file) return;
    const raw = await file.text();
    const loaded = parseProjectJson(raw);
    history.reset(loaded);
    selectedZoomId = loaded.zoomSegments[0]?.id ?? null;
    currentTime = 0;
    syncAllUiFromState();
    void closeTopLayer(shortcutsDialog);
  });

  const startVideoExportBtn = document.getElementById('startVideoExportBtn') as HTMLButtonElement;
  startVideoExportBtn.addEventListener('click', async () => {
    const fps = Number((document.getElementById('exportFpsSelect') as HTMLSelectElement).value) as 30 | 60;
    const resScale = Number((document.getElementById('exportResSelect') as HTMLSelectElement).value) as
      | 0.75
      | 1.0
      | 1.35;

    const progressBox = document.getElementById('exportProgressBox')!;
    const statusText = document.getElementById('exportStatusText')!;
    const pctText = document.getElementById('exportPctText')!;
    const fill = document.getElementById('exportProgressFill')!;

    progressBox.style.display = 'block';
    startVideoExportBtn.disabled = true;

    try {
      const { blob, filename } = await exportCompositeVideo(project(), sourceVideoEl, {
        fps,
        resolutionScale: resScale,
        onProgress: (ratio, frame, total) => {
          const pct = Math.round(ratio * 100);
          statusText.textContent = `Rendering frame ${frame} / ${total}...`;
          pctText.textContent = `${pct}%`;
          fill.style.width = `${pct}%`;
        },
      });
      triggerDownload(blob, filename);
      statusText.textContent = `✓ Exported ${filename}`;
    } catch (err) {
      statusText.textContent = err instanceof Error ? err.message : 'Export failed';
    } finally {
      startVideoExportBtn.disabled = false;
    }
  });

  // --- Global Keyboard Shortcuts ---
  window.addEventListener('keydown', ev => {
    const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') return;
    if (exportDialog.open || shortcutsDialog.open) return;

    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) {
        if (history.redo()) syncAllUiFromState();
      } else {
        if (history.undo()) syncAllUiFromState();
      }
      return;
    }

    if (ev.code === 'Space') {
      ev.preventDefault();
      playPauseBtn.click();
    } else if (ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      insertZoomAtPlayhead();
    } else if (ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      insertKeystrokeAtPlayhead('⌘ K', 'Quick Action');
    } else if (ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      insertSpotlightAtPlayhead();
    } else if (ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      toggleSplitCompare();
    } else if (ev.key.toLowerCase() === 'p') {
      ev.preventDefault();
      exportCurrentPngFrame();
    } else if (ev.key.toLowerCase() === 'l') {
      ev.preventDefault();
      loopToggleBtn.click();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      stepBackBtn.click();
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      stepFwdBtn.click();
    } else if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      deleteSelectedZoomBlock();
    } else if (ev.key === '?') {
      ev.preventDefault();
      shortcutsDialog.showModal();
    }
  });

  window.addEventListener('resize', () => {
    renderTimeline();
    updatePlayheadPositionUi();
  });

  // --- 60 FPS Render & Physics Loop ---
  function tick(now: number): void {
    const rawDt = Math.min(0.1, Math.max(0, (now - lastFrameNow) / 1000));
    lastFrameNow = now;

    if (isPlaying) {
      const prevTime = currentTime;
      const rate =
        getPlaybackRateAtTime(project().speedSegments, currentTime) * playbackSpeedMultiplier;
      currentTime += rawDt * rate;

      soundEngine.checkAndTriggerTimelineClicks(
        project().cursorTrack,
        prevTime,
        currentTime,
        project().style.clickSound,
      );

      if (currentTime >= project().trimEnd) {
        if (loopPlayback) {
          currentTime = project().trimStart;
          if (sourceVideoEl) sourceVideoEl.currentTime = currentTime;
        } else {
          currentTime = project().trimEnd;
          isPlaying = false;
          syncPlayPauseButton();
        }
      }
      updatePlayheadPositionUi();
    }

    lastDiagnostics = renderCompositeFrame(ctx, studioCanvas.width, studioCanvas.height, {
      project: project(),
      timeSec: currentTime,
      sourceVideo: sourceVideoEl,
      webcamVideo: webcamVideoEl,
      showTargetReticle: !isPlaying,
      selectedZoomId,
      splitCompareRatio,
    });

    hudZoomScale.textContent = `${lastDiagnostics.camera.scale.toFixed(2)}×`;
    hudCursorPos.textContent = `${lastDiagnostics.cursor.x.toFixed(2)}, ${lastDiagnostics.cursor.y.toFixed(2)}`;

    requestAnimationFrame(tick);
  }

  syncAllUiFromState();
  requestAnimationFrame(tick);
}

function formatTimecode(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stagecraft'
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapStagecraftStudio);
  } else {
    bootstrapStagecraftStudio();
  }
}
