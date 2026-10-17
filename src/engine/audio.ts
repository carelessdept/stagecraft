/**
 * Synthesizes a tactile macOS Force-Touch / studio mechanical click using WebAudio API.
 * Zero external audio assets required.
 */
export class StudioSoundEngine {
  private ctx: AudioContext | null = null;
  private lastPlayedClickTime = -1;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTactileClick(variant: 'down' | 'up' = 'down'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    const startFreq = variant === 'down' ? 1420 : 1080;
    const endFreq = variant === 'down' ? 190 : 260;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.024);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.028);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  checkAndTriggerTimelineClicks(
    cursorTrack: ReadonlyArray<{ time: number; clicked?: boolean }>,
    prevTime: number,
    currTime: number,
    enabled: boolean,
  ): void {
    if (!enabled || currTime <= prevTime || currTime - prevTime > 0.35) return;
    for (const pt of cursorTrack) {
      if (!pt.clicked) continue;
      if (pt.time > prevTime && pt.time <= currTime) {
        if (Math.abs(pt.time - this.lastPlayedClickTime) > 0.04) {
          this.lastPlayedClickTime = pt.time;
          this.playTactileClick('down');
        }
      }
    }
  }
}
