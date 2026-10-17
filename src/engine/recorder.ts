import type { CursorPoint, KeystrokeEvent, ZoomSegment } from '../state/types.js';
import { generateSmartZoomSegmentsFromClicks } from './cursor.js';
import { clamp } from './spring.js';

export interface RecordingResult {
  videoUrl: string;
  duration: number;
  cursorTrack: CursorPoint[];
  keystrokes: KeystrokeEvent[];
  zoomSegments: ZoomSegment[];
}

export class ScreenCaptureSession {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTimeMs = 0;
  private cursorTrack: CursorPoint[] = [];
  private keystrokes: KeystrokeEvent[] = [];
  private lastSampleMs = 0;
  private cleanupListeners: (() => void) | null = null;

  get isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }

  async start(onStopCallback: (result: RecordingResult) => void): Promise<void> {
    if (this.isRecording) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen recording requires a browser with getDisplayMedia support.');
    }

    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 60, max: 60 },
      },
      audio: true,
    });

    this.chunks = [];
    this.cursorTrack = [];
    this.keystrokes = [];
    this.startTimeMs = performance.now();
    this.lastSampleMs = 0;

    const mimeType = selectSupportedVideoMimeType();
    this.mediaRecorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 12_000_000 })
      : new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = ev => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
      }
    };

    const onPointerMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - this.lastSampleMs < 40) return;
      this.lastSampleMs = now;
      const t = Number(((now - this.startTimeMs) / 1000).toFixed(3));
      this.cursorTrack.push({
        time: t,
        x: Number(clamp(e.clientX / Math.max(1, window.innerWidth), 0.02, 0.98).toFixed(3)),
        y: Number(clamp(e.clientY / Math.max(1, window.innerHeight), 0.02, 0.98).toFixed(3)),
      });
    };

    const onPointerDown = (e: MouseEvent) => {
      const now = performance.now();
      const t = Number(((now - this.startTimeMs) / 1000).toFixed(3));
      this.cursorTrack.push({
        time: t,
        x: Number(clamp(e.clientX / Math.max(1, window.innerWidth), 0.02, 0.98).toFixed(3)),
        y: Number(clamp(e.clientY / Math.max(1, window.innerHeight), 0.02, 0.98).toFixed(3)),
        clicked: true,
        button: e.button === 2 ? 'right' : 'left',
        label: `Click at ${t.toFixed(1)}s`,
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) return;
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('⌃');
      if (e.altKey) mods.push('⌥');
      if (e.shiftKey) mods.push('⇧');
      if (e.metaKey) mods.push('⌘');
      const keyLabel = e.key === 'Enter' ? '↵' : e.key.toUpperCase();
      const combo = [...mods, keyLabel].join(' ');
      const t = Number(((performance.now() - this.startTimeMs) / 1000).toFixed(2));
      this.keystrokes.push({
        id: `key-rec-${this.keystrokes.length + 1}`,
        time: t,
        duration: 1.5,
        keys: combo,
        label: 'Recorded Shortcut',
      });
    };

    window.addEventListener('mousemove', onPointerMove, { passive: true });
    window.addEventListener('mousedown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    this.cleanupListeners = () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };

    // Also stop if user clicks the browser's native "Stop sharing" banner
    const videoTrack = this.stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        if (this.isRecording) {
          this.stop();
        }
      });
    }

    this.mediaRecorder.onstop = () => {
      this.cleanupListeners?.();
      this.cleanupListeners = null;
      const elapsedSec = Math.max(2.0, Number(((performance.now() - this.startTimeMs) / 1000).toFixed(2)));
      const blob = new Blob(this.chunks, { type: mimeType || 'video/webm' });
      const videoUrl = URL.createObjectURL(blob);

      if (this.cursorTrack.length === 0) {
        this.cursorTrack = [
          { time: 0, x: 0.5, y: 0.5 },
          { time: Number((elapsedSec * 0.35).toFixed(2)), x: 0.36, y: 0.42, clicked: true, label: 'Focus Point 1' },
          { time: Number((elapsedSec * 0.72).toFixed(2)), x: 0.68, y: 0.58, clicked: true, label: 'Focus Point 2' },
          { time: elapsedSec, x: 0.5, y: 0.5 },
        ];
      }

      const zoomSegments = generateSmartZoomSegmentsFromClicks(
        this.cursorTrack,
        elapsedSec,
        2.15,
        'snappy',
      );

      this.stream?.getTracks().forEach(tr => tr.stop());
      this.stream = null;
      this.mediaRecorder = null;

      onStopCallback({
        videoUrl,
        duration: elapsedSec,
        cursorTrack: this.cursorTrack,
        keystrokes: this.keystrokes,
        zoomSegments,
      });
    };

    this.mediaRecorder.start(100);
  }

  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }
}

export function selectSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}
