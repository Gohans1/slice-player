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
  private currentPlayRequestId = 0;
  private lastTimeUpdate = 0;

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = "anonymous";
    this.audioEl.preload = "auto";
  }

  public init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      const source = this.audioCtx.createMediaElementSource(this.audioEl);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      source.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn("[AudioEngine] Web Audio graph init fallback to direct audio element", e);
    }

    this.audioEl.addEventListener("ended", () => {
      if (this.onSegmentEndCallback) {
        const cb = this.onSegmentEndCallback;
        this.onSegmentEndCallback = null;
        this.currentSegmentEnd = null;
        cb();
      }
    });

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

    const requestId = ++this.currentPlayRequestId;

    // Disarm boundary checks during load and seek transition
    this.currentSegmentEnd = null;
    this.onSegmentEndCallback = null;
    this.onTimeUpdateCallback = onTimeUpdate || null;

    // Soft fade-out current audio before loading new track
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);
    }

    // Check if same track is already loaded
    const isSameSource = this.audioEl.src === new URL(streamUrl, window.location.href).href;

    if (!isSameSource) {
      this.audioEl.src = streamUrl;
      await new Promise<void>((resolve, reject) => {
        let isDone = false;
        const cleanup = () => {
          if (isDone) return;
          isDone = true;
          this.audioEl.removeEventListener("canplay", onCanPlay);
          this.audioEl.removeEventListener("error", onError);
          clearTimeout(timer);
        };
        const onCanPlay = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("Audio load failed or 404")); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("Audio load timeout (10s)")); }, 10000);

        this.audioEl.addEventListener("canplay", onCanPlay);
        this.audioEl.addEventListener("error", onError);
        this.audioEl.load();
      });
    }

    if (this.currentPlayRequestId !== requestId) return;

    // Seek to startTime if not already there
    if (Math.abs(this.audioEl.currentTime - startTime) > 0.05) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          this.audioEl.removeEventListener("seeked", onSeeked);
          clearTimeout(fallback);
          resolve();
        };
        const fallback = setTimeout(() => {
          this.audioEl.removeEventListener("seeked", onSeeked);
          resolve();
        }, 150);
        this.audioEl.addEventListener("seeked", onSeeked);
        this.audioEl.currentTime = startTime;
      });
    }

    if (this.currentPlayRequestId !== requestId) return;

    try {
      await this.audioEl.play();
      if (this.currentPlayRequestId !== requestId) return;

      // Arm boundary monitor ONLY AFTER playback successfully starts at the target seek point
      this.currentSegmentEnd = endTime;
      this.onSegmentEndCallback = onEnd;

      // Ramp gain up to 1.0 in 15ms after playback successfully starts
      if (this.gainNode && this.audioCtx) {
        const playNow = this.audioCtx.currentTime;
        this.gainNode.gain.setValueAtTime(0.0001, playNow);
        this.gainNode.gain.linearRampToValueAtTime(1.0, playNow + 0.015);
      }
    } catch (err) {
      console.warn("[AudioEngine] Autoplay prevented:", err);
    }
  }

  public pause() {
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      setTimeout(() => this.audioEl.pause(), 16);
    } else {
      this.audioEl.pause();
    }
  }

  public async resume() {
    await this.resumeContext();
    try {
      await this.audioEl.play();
      if (this.gainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.gainNode.gain.setValueAtTime(0.0001, now);
        this.gainNode.gain.linearRampToValueAtTime(1.0, now + 0.015);
      }
    } catch (err) {
      console.warn("[AudioEngine] Resume prevented:", err);
    }
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
   * Unified boundary checking logic used by rAF, timeupdate event, and background interval.
   * Throttles UI progress notification to 10Hz to prevent global React 140 FPS thrashing,
   * while enforcing the segment cut immediately.
   */
  private checkBoundary = () => {
    if (this.audioEl.paused) return;

    const curTime = this.audioEl.currentTime;
    const now = performance.now();

    // Throttle progress callback to 10Hz (every 100ms) to prevent UI re-render thrashing
    if (this.onTimeUpdateCallback && (now - this.lastTimeUpdate >= 100 || curTime < 0.1)) {
      this.lastTimeUpdate = now;
      this.onTimeUpdateCallback(curTime);
    }

    if (this.currentSegmentEnd !== null) {
      if (curTime >= this.currentSegmentEnd) {
        // Micro fade-out to prevent speaker DC offset pop
        if (this.gainNode && this.audioCtx) {
          const now = this.audioCtx.currentTime;
          this.gainNode.gain.cancelScheduledValues(now);
          this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
          this.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);
        }
        // Stop audio immediately so it doesn't leak into subsequent music
        this.audioEl.pause();
        this.currentSegmentEnd = null;
        if (this.onSegmentEndCallback) {
          const cb = this.onSegmentEndCallback;
          this.onSegmentEndCallback = null;
          cb();
        }
      }
    }
  };

  /**
   * Monitor currentTime using requestAnimationFrame, supplemented by timeupdate and setInterval
   * to ensure background/minimized windows never miss segment boundaries.
   */
  private startBoundaryMonitor = () => {
    // Native timeupdate listener
    this.audioEl.addEventListener("timeupdate", this.checkBoundary);

    // 50ms interval fallback for when Chromium suspends rAF in background/minimized mode
    setInterval(this.checkBoundary, 50);

    // rAF loop for high-frequency UI updates when visible
    const loop = () => {
      this.checkBoundary();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(loop);
    }
  };
}

export const audioEngine = new AudioEngine();
