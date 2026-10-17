import type {
  SpeedSegment,
  StagecraftProject,
  ZoomSegment,
} from '../state/types.js';
import { clamp } from './spring.js';

export class ProjectHistoryStack {
  private past: StagecraftProject[] = [];
  private future: StagecraftProject[] = [];
  private current: StagecraftProject;
  private readonly maxDepth: number;

  constructor(initial: StagecraftProject, maxDepth = 50) {
    this.current = structuredClone(initial);
    this.maxDepth = maxDepth;
  }

  get state(): StagecraftProject {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoCount(): number {
    return this.past.length;
  }

  get redoCount(): number {
    return this.future.length;
  }

  /**
   * Commits a new project snapshot into the undo history.
   */
  commit(next: StagecraftProject): StagecraftProject {
    this.past.push(structuredClone(this.current));
    if (this.past.length > this.maxDepth) {
      this.past.shift();
    }
    this.current = structuredClone(next);
    this.future = [];
    return this.current;
  }

  /**
   * Updates live state without pushing to history (for continuous slider/drag operations)
   * after `markCheckpoint()` was already called on pointerdown.
   */
  replaceCurrent(next: StagecraftProject): StagecraftProject {
    this.current = structuredClone(next);
    return this.current;
  }

  /**
   * Records the current state onto the undo stack before a continuous drag begins.
   */
  markCheckpoint(): void {
    this.past.push(structuredClone(this.current));
    if (this.past.length > this.maxDepth) {
      this.past.shift();
    }
    this.future = [];
  }

  undo(): StagecraftProject | null {
    if (this.past.length === 0) return null;
    const prev = this.past.pop()!;
    this.future.push(structuredClone(this.current));
    this.current = prev;
    return this.current;
  }

  redo(): StagecraftProject | null {
    if (this.future.length === 0) return null;
    const next = this.future.pop()!;
    this.past.push(structuredClone(this.current));
    this.current = next;
    return this.current;
  }

  reset(project: StagecraftProject): StagecraftProject {
    this.past = [];
    this.future = [];
    this.current = structuredClone(project);
    return this.current;
  }
}

/**
 * Inserts a new non-overlapping ZoomSegment at `atTime` and sorts segments chronologically.
 */
export function insertZoomSegmentAtTime(
  segments: readonly ZoomSegment[],
  duration: number,
  atTime: number,
  partial?: Partial<ZoomSegment>,
): { segments: ZoomSegment[]; created: ZoomSegment } {
  const safeStart = clamp(atTime, 0, Math.max(0.4, duration - 0.6));
  const desiredEnd = clamp(safeStart + (partial?.endTime ? partial.endTime - safeStart : 1.8), safeStart + 0.4, duration);

  // Trim or shift existing overlapping segments so timeline tracks never collide
  const adjusted: ZoomSegment[] = [];
  for (const seg of segments) {
    if (seg.endTime <= safeStart || seg.startTime >= desiredEnd) {
      adjusted.push({ ...seg });
    } else if (seg.startTime < safeStart && seg.endTime > safeStart) {
      if (safeStart - seg.startTime >= 0.35) {
        adjusted.push({ ...seg, endTime: Number(safeStart.toFixed(2)) });
      }
    } else if (seg.startTime < desiredEnd && seg.endTime > desiredEnd) {
      if (seg.endTime - desiredEnd >= 0.35) {
        adjusted.push({ ...seg, startTime: Number(desiredEnd.toFixed(2)) });
      }
    }
  }

  const created: ZoomSegment = {
    id: partial?.id ?? `zoom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startTime: Number(safeStart.toFixed(2)),
    endTime: Number(desiredEnd.toFixed(2)),
    scale: clamp(partial?.scale ?? 2.25, 1.15, 4.0),
    targetX: clamp(partial?.targetX ?? 0.5, 0.05, 0.95),
    targetY: clamp(partial?.targetY ?? 0.5, 0.05, 0.95),
    mode: partial?.mode ?? 'auto-cursor',
    springPreset: partial?.springPreset ?? 'snappy',
    label: partial?.label ?? `Zoom ${(adjusted.length + 1).toString()}`,
  };

  adjusted.push(created);
  adjusted.sort((a, b) => a.startTime - b.startTime);

  return { segments: adjusted, created };
}

/**
 * Evaluates playback rate at `timeSec` from speed ramp segments.
 */
export function getPlaybackRateAtTime(
  speedSegments: readonly SpeedSegment[],
  timeSec: number,
): number {
  for (const seg of speedSegments) {
    if (timeSec >= seg.startTime && timeSec <= seg.endTime) {
      return clamp(seg.rate, 0.25, 4.0);
    }
  }
  return 1.0;
}
