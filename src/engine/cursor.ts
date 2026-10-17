import type {
  CursorPoint,
  EvaluatedCursorState,
  SpringPresetName,
  ZoomSegment,
} from '../state/types.js';
import { clamp } from './spring.js';

/**
 * Evaluates a 1D cubic Hermite / Catmull-Rom spline with tangent clamping.
 */
export function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
  tension = 0.5,
): number {
  if (t <= 0) return p1;
  if (t >= 1) return p2;
  const t2 = t * t;
  const t3 = t2 * t;
  // Clamp tangent to zero if adjacent segment is stationary to prevent overshoot loops during pauses
  const m0 = Math.abs(p1 - p0) < 0.0015 ? 0 : (p2 - p0) * tension;
  const m1 = Math.abs(p3 - p2) < 0.0015 ? 0 : (p3 - p1) * tension;
  return (
    (2 * p1 - 2 * p2 + m0 + m1) * t3 +
    (-3 * p1 + 3 * p2 - 2 * m0 - m1) * t2 +
    m0 * t +
    p1
  );
}

/**
 * Minimum-jerk human hand trajectory (Flash & Hogan 1985):
 * Zero velocity and zero acceleration at both endpoints (u=0 and u=1).
 */
export function minimumJerk(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * u * (10 - 15 * u + 6 * u * u);
}

/**
 * Smoothstep easing helper kept for compatibility.
 */
export function smoothstep(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

/**
 * Evaluates raw interpolated cursor position with stationary dwell detection
 * and Fitts's Law minimum-jerk easing between rest pauses.
 */
export function sampleRawCursorPosition(
  track: readonly CursorPoint[],
  timeSec: number,
): { x: number; y: number } {
  if (track.length === 0) {
    return { x: 0.5, y: 0.5 };
  }
  if (track.length === 1 || timeSec <= track[0]!.time) {
    return { x: clamp(track[0]!.x, 0, 1), y: clamp(track[0]!.y, 0, 1) };
  }
  const last = track[track.length - 1]!;
  if (timeSec >= last.time) {
    return { x: clamp(last.x, 0, 1), y: clamp(last.y, 0, 1) };
  }

  // Binary search for segment [i, i+1]
  let low = 0;
  let high = track.length - 2;
  let idx = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midPoint = track[mid]!;
    const nextPoint = track[mid + 1]!;
    if (timeSec >= midPoint.time && timeSec <= nextPoint.time) {
      idx = mid;
      break;
    }
    if (timeSec < midPoint.time) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  const p1 = track[idx]!;
  const p2 = track[idx + 1]!;
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

  // Stationary dwell: keep cursor 100% locked with zero spline drift
  if (dist < 0.002) {
    return { x: clamp(p1.x, 0, 1), y: clamp(p1.y, 0, 1) };
  }

  const p0 = track[Math.max(0, idx - 1)]!;
  const p3 = track[Math.min(track.length - 1, idx + 2)]!;

  const span = Math.max(1e-4, p2.time - p1.time);
  const rawU = clamp((timeSec - p1.time) / span, 0, 1);

  // Check if p1 is the start of a move (after a pause) and p2 is the end of a move (before a pause/click)
  const startsFromRest = idx === 0 || Math.hypot(p1.x - p0.x, p1.y - p0.y) < 0.004 || Boolean(p1.clicked);
  const endsAtRest =
    idx === track.length - 2 || Math.hypot(p3.x - p2.x, p3.y - p2.y) < 0.004 || Boolean(p2.clicked);

  // Only apply minimum-jerk easing when moving between distinct rest targets;
  // for dense continuous mouse samples, keep rawU linear so motion never stutters.
  let u = rawU;
  if (span > 0.12 && startsFromRest && endsAtRest) {
    u = minimumJerk(rawU);
  } else if (span > 0.12 && startsFromRest) {
    u = rawU * rawU * (2 - rawU); // smooth accelerate out of rest
  } else if (span > 0.12 && endsAtRest) {
    u = 1 - (1 - rawU) * (1 - rawU); // smooth decelerate into rest
  }

  // Subtle human wrist arc on long point-to-point moves
  const arcMag = startsFromRest && endsAtRest ? Math.min(0.018, dist * 0.055) : 0;
  const arcBell = Math.sin(u * Math.PI);
  const nx = -(p2.y - p1.y) / dist;
  const ny = (p2.x - p1.x) / dist;

  const baseX = catmullRom(p0.x, p1.x, p2.x, p3.x, u, 0.28);
  const baseY = catmullRom(p0.y, p1.y, p2.y, p3.y, u, 0.28);

  const x = clamp(baseX + nx * arcMag * arcBell, 0, 1);
  const y = clamp(baseY + ny * arcMag * arcBell, 0, 1);
  return { x, y };
}

/**
 * Evaluates smoothed cursor position, instantaneous velocity vector, click compression,
 * and active click ripples at `timeSec`.
 */
export function evaluateCursorAtTime(
  track: readonly CursorPoint[],
  timeSec: number,
  smoothingPct = 65,
): EvaluatedCursorState {
  const windowRadius = (clamp(smoothingPct, 0, 100) / 100) * 0.045; // Subtle +-45ms Gaussian filter
  let x = 0;
  let y = 0;

  const centerPos = sampleRawCursorPosition(track, timeSec);
  if (windowRadius <= 0.002) {
    x = centerPos.x;
    y = centerPos.y;
  } else {
    const weights = [0.08, 0.22, 0.4, 0.22, 0.08];
    const offsets = [-1, -0.5, 0, 0.5, 1];
    for (let i = 0; i < offsets.length; i++) {
      const sampleT = Math.max(0, timeSec + offsets[i]! * windowRadius);
      const pos = sampleRawCursorPosition(track, sampleT);
      const w = weights[i]!;
      x += pos.x * w;
      y += pos.y * w;
    }
  }

  // Finite difference velocity over 16ms
  const dt = 0.016;
  const prevPos = sampleRawCursorPosition(track, Math.max(0, timeSec - dt));
  const nextPos = sampleRawCursorPosition(track, timeSec + dt);
  const vx = (nextPos.x - prevPos.x) / (2 * dt);
  const vy = (nextPos.y - prevPos.y) / (2 * dt);
  const speed = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);

  const rippleDuration = 0.52;
  const pressWindow = 0.14;
  let isPressed = false;
  const activeRipples: EvaluatedCursorState['activeRipples'] = [];

  for (const pt of track) {
    if (!pt.clicked) continue;
    const elapsed = timeSec - pt.time;
    if (elapsed >= -0.015 && elapsed <= pressWindow) {
      isPressed = true;
    }
    if (elapsed >= 0 && elapsed <= rippleDuration) {
      activeRipples.push({
        x: pt.x,
        y: pt.y,
        progress: clamp(elapsed / rippleDuration, 0, 1),
        label: pt.label,
      });
    }
  }

  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    vx,
    vy,
    speed,
    angle,
    isPressed,
    activeRipples,
  };
}

/**
 * Automatically clusters click events in the cursor track into intelligent,
 * non-overlapping Auto-Zoom segments (Screen Studio style).
 */
export function generateSmartZoomSegmentsFromClicks(
  track: readonly CursorPoint[],
  duration: number,
  defaultScale = 1.85,
  springPreset: SpringPresetName = 'snappy',
): ZoomSegment[] {
  const clicks = track.filter(p => p.clicked);
  if (clicks.length === 0) return [];

  const segments: ZoomSegment[] = [];
  const leadIn = 0.35;
  const holdAfter = 1.45;
  const mergeGap = 0.9;

  let clusterStart = Math.max(0.15, clicks[0]!.time - leadIn);
  let clusterEnd = Math.min(duration - 0.15, clicks[0]!.time + holdAfter);
  let sumX = clicks[0]!.x;
  let sumY = clicks[0]!.y;
  let count = 1;
  let label = clicks[0]!.label ?? 'Auto Zoom 1';

  for (let i = 1; i < clicks.length; i++) {
    const click = clicks[i]!;
    const proposedStart = Math.max(0.15, click.time - leadIn);
    const dist = Math.hypot(click.x - sumX / count, click.y - sumY / count);

    if (proposedStart <= clusterEnd + mergeGap && dist < 0.38) {
      clusterEnd = Math.min(duration - 0.15, Math.max(clusterEnd, click.time + holdAfter));
      sumX += click.x;
      sumY += click.y;
      count++;
    } else {
      segments.push({
        id: `zoom-auto-${segments.length + 1}`,
        startTime: Number(clusterStart.toFixed(2)),
        endTime: Number(clusterEnd.toFixed(2)),
        scale: defaultScale,
        targetX: Number((sumX / count).toFixed(3)),
        targetY: Number((sumY / count).toFixed(3)),
        mode: 'auto-cursor',
        springPreset,
        label,
      });

      clusterStart = proposedStart;
      clusterEnd = Math.min(duration - 0.15, click.time + holdAfter);
      sumX = click.x;
      sumY = click.y;
      count = 1;
      label = click.label ?? `Auto Zoom ${segments.length + 1}`;
    }
  }

  segments.push({
    id: `zoom-auto-${segments.length + 1}`,
    startTime: Number(clusterStart.toFixed(2)),
    endTime: Number(clusterEnd.toFixed(2)),
    scale: defaultScale,
    targetX: Number((sumX / count).toFixed(3)),
    targetY: Number((sumY / count).toFixed(3)),
    mode: 'auto-cursor',
    springPreset,
    label,
  });

  return segments;
}
