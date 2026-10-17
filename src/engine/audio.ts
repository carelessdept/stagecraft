/**
 * Synthesizes an authentic, quiet macOS Force-Touch trackpad acoustic impulse
 * using a 3.5ms bandpass-filtered noise burst + 4.5ms low-end body thud.
 * Zero pitched oscillator sweeps (no arcade "pew" tones) and zero external assets.
 */
export class StudioSoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
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

  private getImpulseNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    // 12ms micro-buffer with fast exponential decay envelope baked into samples
    const length = Math.max(64, Math.floor(ctx.sampleRate * 0.012));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.exp(-t * 14);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  playTactileClick(variant: 'down' | 'up' = 'down'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Crisp mechanical surface transient (bandpass-filtered aperiodic impulse)
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.getImpulseNoiseBuffer(ctx);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(variant === 'down' ? 1950 : 2450, now);
    bandpass.Q.setValueAtTime(3.0, now);

    const noiseGain = ctx.createGain();
    const peakGain = variant === 'down' ? 0.085 : 0.045;
    noiseGain.gain.setValueAtTime(peakGain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.006);

    noiseSrc.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSrc.start(now);
    noiseSrc.stop(now + 0.008);

    // 2. Subtle 5ms low-frequency Taptic body thud (sub-audible pitch, purely tactile weight)
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(variant === 'down' ? 115 : 135, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(48, now + 0.005);

    bodyGain.gain.setValueAtTime(variant === 'down' ? 0.055 : 0.025, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0004, now + 0.006);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.007);
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
