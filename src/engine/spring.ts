import type {
  CameraFrameState,
  SpringConfig,
  SpringPresetName,
  StagecraftProject,
  ZoomSegment,
} from '../state/types.js';

export const SPRING_PRESETS: Record<Exclude<SpringPresetName, 'custom'>, SpringConfig> = {
  mellow: { stiffness: 140, damping: 22, mass: 1.0 },
  snappy: { stiffness: 260, damping: 26, mass: 0.9 },
  bouncy: { stiffness: 320, damping: 18, mass: 0.85 },
  cinema: { stiffness: 95, damping: 20, mass: 1.2 },
};

export interface SpringState1D {
  position: number;
  velocity: number;
}

export interface SpringCurveDiagnostics {
  points: number[];
  dampingRatio: number;
  regime: 'underdamped' | 'critically-damped' | 'overdamped';
  settlingTimeMs: number;
  peakOvershootPct: number;
}

export function resolveSpringConfig(
  preset: SpringPresetName,
  custom?: SpringConfig,
): SpringConfig {
  if (preset === 'custom' && custom) {
    return {
      stiffness: clamp(custom.stiffness, 20, 800),
      damping: clamp(custom.damping, 4, 120),
      mass: clamp(custom.mass, 0.2, 5.0),
    };
  }
  return SPRING_PRESETS[preset === 'custom' ? 'snappy' : preset];
}

/**
 * Advances a 1D damped harmonic oscillator by `dt` seconds using 4-substep
 * symplectic Euler integration for unconditional stability across high stiffness.
 */
export function stepSpring1D(
  state: SpringState1D,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState1D {
  if (dt <= 0) return { ...state };
  const substeps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / substeps;
  let pos = state.position;
  let vel = state.velocity;
  const k = Math.max(1, config.stiffness);
  const c = Math.max(0.5, config.damping);
  const invMass = 1 / Math.max(0.1, config.mass);

  for (let i = 0; i < substeps; i++) {
    const displacement = pos - target;
    const accel = (-k * displacement - c * vel) * invMass;
    vel += accel * h;
    pos += vel * h;
  }

  if (Math.abs(pos - target) < 1e-5 && Math.abs(vel) < 1e-4) {
    pos = target;
    vel = 0;
  }

  return { position: pos, velocity: vel };
}

/**
 * Computes unit step response (0 -> 1) and physical diagnostics for the Inspector curve display.
 */
export function sampleSpringResponseCurve(
  config: SpringConfig,
  durationSec = 1.0,
  sampleCount = 72,
): SpringCurveDiagnostics {
  const k = Math.max(1, config.stiffness);
  const c = Math.max(0.5, config.damping);
  const m = Math.max(0.1, config.mass);
  const dampingRatio = c / (2 * Math.sqrt(k * m));

  let regime: SpringCurveDiagnostics['regime'] = 'underdamped';
  if (Math.abs(dampingRatio - 1) <= 0.04) {
    regime = 'critically-damped';
  } else if (dampingRatio > 1.04) {
    regime = 'overdamped';
  }

  let state: SpringState1D = { position: 0, velocity: 0 };
  const dt = durationSec / Math.max(1, sampleCount - 1);
  const points: number[] = [];
  let maxPos = 1;
  let lastOutsideBandTime = 0;

  for (let i = 0; i < sampleCount; i++) {
    const t = i * dt;
    if (i > 0) {
      state = stepSpring1D(state, 1, config, dt);
    }
    points.push(state.position);
    if (state.position > maxPos) {
      maxPos = state.position;
    }
    if (Math.abs(state.position - 1) > 0.015 || Math.abs(state.velocity) > 0.05) {
      lastOutsideBandTime = t;
    }
  }

  return {
    points,
    dampingRatio: Number(dampingRatio.toFixed(2)),
    regime,
    settlingTimeMs: Math.round(lastOutsideBandTime * 1000),
    peakOvershootPct: Math.max(0, Math.round((maxPos - 1) * 100)),
  };
}

/**
 * Finds the active ZoomSegment at `timeSec`.
 */
export function findActiveZoomSegment(
  segments: readonly ZoomSegment[],
  timeSec: number,
): ZoomSegment | null {
  for (const seg of segments) {
    if (timeSec >= seg.startTime && timeSec <= seg.endTime) {
      return seg;
    }
  }
  return null;
}

/**
 * Clamps normalized camera focus coordinates so a zoomed viewport of `scale`
 * never exposes blank space outside [0..1].
 */
export function clampViewportFocus(focusCoord: number, scale: number): number {
  if (scale <= 1.001) return 0.5;
  const halfSpan = 0.5 / scale;
  return clamp(focusCoord, halfSpan, 1 - halfSpan);
}

/**
 * Deterministically evaluates the 3-DOF spring camera (scale, focusX, focusY)
 * at any timeline timestamp `timeSec`.
 */
export function evaluateCameraAtTime(
  project: Pick<StagecraftProject, 'zoomSegments' | 'style'>,
  timeSec: number,
  cursorAtTime: (t: number) => { x: number; y: number },
): CameraFrameState {
  const clampedTime = Math.max(0, timeSec);
  const stepDt = 1 / 120;
  let scaleState: SpringState1D = { position: 1, velocity: 0 };
  let xState: SpringState1D = { position: 0.5, velocity: 0 };
  let yState: SpringState1D = { position: 0.5, velocity: 0 };

  const baseConfig = resolveSpringConfig(
    project.style.springPreset,
    project.style.springConfig,
  );

  let t = 0;
  let activeSeg: ZoomSegment | null = null;

  while (t < clampedTime) {
    const dt = Math.min(stepDt, clampedTime - t);
    t += dt;
    activeSeg = findActiveZoomSegment(project.zoomSegments, t);

    const segConfig = activeSeg
      ? resolveSpringConfig(
          activeSeg.springPreset === 'custom'
            ? project.style.springPreset
            : activeSeg.springPreset,
          project.style.springConfig,
        )
      : baseConfig;

    let targetScale = 1.0;
    let rawTargetX = 0.5;
    let rawTargetY = 0.5;

    if (activeSeg) {
      targetScale = clamp(activeSeg.scale, 1.0, 4.5);
      if (activeSeg.mode === 'auto-cursor') {
        const cursorPos = cursorAtTime(t);
        // Blend 75% live cursor + 25% segment anchor for cinematic framing stability
        rawTargetX = cursorPos.x * 0.78 + activeSeg.targetX * 0.22;
        rawTargetY = cursorPos.y * 0.78 + activeSeg.targetY * 0.22;
      } else {
        rawTargetX = activeSeg.targetX;
        rawTargetY = activeSeg.targetY;
      }
    }

    const targetX = clampViewportFocus(rawTargetX, targetScale);
    const targetY = clampViewportFocus(rawTargetY, targetScale);

    scaleState = stepSpring1D(scaleState, targetScale, segConfig, dt);
    // Focus pan uses a slightly gentler spring when returning to 1.0x so zoom-out feels natural
    const panConfig: SpringConfig = activeSeg
      ? segConfig
      : {
          stiffness: segConfig.stiffness * 0.85,
          damping: segConfig.damping * 1.05,
          mass: segConfig.mass,
        };
    xState = stepSpring1D(xState, targetX, panConfig, dt);
    yState = stepSpring1D(yState, targetY, panConfig, dt);
  }

  activeSeg = findActiveZoomSegment(project.zoomSegments, clampedTime);
  const effectiveScale = Math.max(1.0, scaleState.position);

  return {
    scale: effectiveScale,
    focusX: clampViewportFocus(xState.position, effectiveScale),
    focusY: clampViewportFocus(yState.position, effectiveScale),
    velocityX: xState.velocity,
    velocityY: yState.velocity,
    velocityScale: scaleState.velocity,
    activeSegment: activeSeg,
  };
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}
