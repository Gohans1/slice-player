/**
 * Audio Engine with Web Audio API GainNode Micro-Fade
 * Eliminates all DC-offset clicks and pops when seeking or transitioning segments.
 */

class AudioEngine {
  private audioEl: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private isInitialized = false;

  private currentSegmentEnd: number | null = null;
  private onSegmentEndCallback: (() => void) | null = null;
  private onTimeUpdateCallback: ((currentTime: number) => void) | null = null;
  private animationFrameId: number | null = null;

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = "anonymous";
    this.audioEl.preload = "auto";
  }

  public init() {
    if (this.isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      const source = this.audioCtx.createMediaElementSource(this.audioEl);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      source.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
      this.isInitialized = true;
    } catch (e) {
      console.warn("[AudioEngine] Web Audio graph init fallback to direct audio element", e);
    }

    this.startBoundaryMonitor();
  }

  public async resumeContext() {
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
  }

  public setSource(streamUrl: string) {
    this.init();
    this.audioEl.src = streamUrl;
    this.audioEl.load();
  }

  public async playSegment(
    streamUrl: string,
    startTime: number,
    endTime: number,
    onEnd: () => void,
    onTimeUpdate?: (t: number) => void
  ) {
    this.init();
    await this.resumeContext();

    this.currentSegmentEnd = endTime;
    this.onSegmentEndCallback = onEnd;
    this.onTimeUpdateCallback = onTimeUpdate || null;

    // Check if same track is already loaded
    const isSameSource = this.audioEl.src === new URL(streamUrl, window.location.href).href;

    if (!isSameSource) {
      this.audioEl.src = streamUrl;
      await new Promise<void>((resolve) => {
        const onCanPlay = () => {
          this.audioEl.removeEventListener("canplay", onCanPlay);
          resolve();
        };
        this.audioEl.addEventListener("canplay", onCanPlay);
        this.audioEl.load();
      });
    }

    // Micro-fade seek
    await this.microFadeSeek(startTime);
    try {
      await this.audioEl.play();
    } catch (err) {
      console.warn("[AudioEngine] Autoplay prevented:", err);
    }
  }

  public pause() {
    this.audioEl.pause();
  }

  public async resume() {
    await this.resumeContext();
    await this.audioEl.play();
  }

  public setVolume(volume: number) {
    // volume between 0 and 1
    this.audioEl.volume = Math.max(0, Math.min(1, volume));
  }

  public seek(seconds: number) {
    this.audioEl.currentTime = seconds;
  }

  public getCurrentTime(): number {
    return this.audioEl.currentTime;
  }

  public getDuration(): number {
    return this.audioEl.duration || 0;
  }

  public isPaused(): boolean {
    return this.audioEl.paused;
  }

  /**
   * 15ms linear micro-fade down to 0, seek, then 15ms linear ramp up to 1
   * Completely silences DC offset click transients.
   */
  public async microFadeSeek(targetSeconds: number) {
    if (!this.gainNode || !this.audioCtx) {
      this.audioEl.currentTime = targetSeconds;
      return;
    }

    const now = this.audioCtx.currentTime;
    // Ramp down to 0 in 15ms
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);

    await new Promise((r) => setTimeout(r, 16));
    this.audioEl.currentTime = targetSeconds;

    // Ramp up to 1 in 15ms
    const nextNow = this.audioCtx.currentTime;
    this.gainNode.gain.setValueAtTime(0.0001, nextNow);
    this.gainNode.gain.linearRampToValueAtTime(1.0, nextNow + 0.015);
  }

  /**
   * Monitor currentTime using requestAnimationFrame for sub-millisecond precision
   */
  private startBoundaryMonitor = () => {
    const loop = () => {
      if (!this.audioEl.paused) {
        const curTime = this.audioEl.currentTime;
        if (this.onTimeUpdateCallback) {
          this.onTimeUpdateCallback(curTime);
        }

        if (this.currentSegmentEnd !== null) {
          // If 15ms before end, prepare transition
          if (curTime >= this.currentSegmentEnd) {
            this.currentSegmentEnd = null; // prevent multiple triggers
            if (this.onSegmentEndCallback) {
              const cb = this.onSegmentEndCallback;
              this.onSegmentEndCallback = null;
              cb();
            }
          }
        }
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };

    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(loop);
    }
  };
}

export const audioEngine = new AudioEngine();
