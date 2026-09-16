/**
 * Audio Engine with Web Audio API GainNode Micro-Fade
 * Eliminates all DC-offset clicks and pops when seeking or transitioning segments.
 */

class AudioEngine {
  private audioEl: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private fadeGainNode: GainNode | null = null;
  private volumeGainNode: GainNode | null = null;
  private currentVolume = 0.8;
  private isInitialized = false;

  private currentSegmentStart: number | null = null;
  private currentSegmentEnd: number | null = null;
  private onSegmentEndCallback: (() => void) | null = null;
  private onTimeUpdateCallback: ((currentTime: number) => void) | null = null;
  private animationFrameId: number | null = null;
  private currentPlayRequestId = 0;
  private pauseRequestId = 0;
  private activeSeekCleanup: (() => void) | null = null;
  private isSeekingSettled = true;
  private lastTimeUpdate = 0;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private isFadingOut = false;
  private tickerWorker: Worker | null = null;
  private fallbackTickerInterval: ReturnType<typeof setInterval> | null = null;
  private onErrorCallback: ((err: MediaError | null) => void) | null = null;

  public setOnErrorCallback(cb: ((err: MediaError | null) => void) | null) {
    this.onErrorCallback = cb;
  }

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

      // Two-stage gain graph:
      // [source] -> [fadeGainNode] (0.0001 <-> 1.0 micro-fades) -> [volumeGainNode] (user volume) -> [destination]
      this.fadeGainNode = this.audioCtx.createGain();
      this.fadeGainNode.gain.value = 1.0;

      this.volumeGainNode = this.audioCtx.createGain();
      this.volumeGainNode.gain.value = this.currentVolume;

      source.connect(this.fadeGainNode);
      this.fadeGainNode.connect(this.volumeGainNode);
      this.volumeGainNode.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn("[AudioEngine] Web Audio graph init fallback to direct audio element", e);
    }

    this.audioEl.addEventListener("ended", () => {
      this.stopTicker();
      this.stopRafLoop();
      if (this.onSegmentEndCallback) {
        const cb = this.onSegmentEndCallback;
        this.onSegmentEndCallback = null;
        this.currentSegmentStart = null;
        this.currentSegmentEnd = null;
        cb();
      }
    });

    this.audioEl.addEventListener("error", () => {
      this.stopTicker();
      this.stopRafLoop();
      this.isFadingOut = false;
      if (this.onErrorCallback) {
        this.onErrorCallback(this.audioEl.error);
      }
    });

    this.startBoundaryMonitor();
  }

  public async resumeContext() {
    if (this.audioCtx && this.audioCtx.state !== "running") {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn("[AudioEngine] AudioContext resume deferred pending user gesture:", e);
      }
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

    this.pauseRequestId++;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }
    this.isFadingOut = false;

    const requestId = ++this.currentPlayRequestId;

    // Disarm boundary checks during load and seek transition
    this.currentSegmentStart = null;
    this.currentSegmentEnd = null;
    this.onSegmentEndCallback = null;
    this.onTimeUpdateCallback = onTimeUpdate || null;

    // Soft fade-out current audio before loading new track or seeking
    if (this.fadeGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.fadeGainNode.gain.cancelScheduledValues(now);
      this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, now);
      this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);
    }

    // Await micro-fade completion if playing before changing source or seeking
    if (!this.audioEl.paused && this.fadeGainNode && this.audioCtx) {
      await new Promise((r) => setTimeout(r, 16));
    }

    // Check if same track is already loaded
    const isSameSource = this.audioEl.src === new URL(streamUrl, window.location.href).href;

    if (!isSameSource) {
      if (this.currentPlayRequestId !== requestId) return;
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
        const onError = () => {
          cleanup();
          if (this.currentPlayRequestId === requestId) {
            reject(new Error("Audio load failed or 404"));
          } else {
            resolve();
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          if (this.currentPlayRequestId === requestId) {
            reject(new Error("Audio load timeout (15s)"));
          } else {
            resolve();
          }
        }, 15000);

        this.audioEl.addEventListener("canplay", onCanPlay);
        this.audioEl.addEventListener("error", onError);
        this.audioEl.load();
      });
    }

    if (this.currentPlayRequestId !== requestId) return;

    // Seek to startTime if not already there
    if (Math.abs(this.audioEl.currentTime - startTime) > 0.05) {
      this.isSeekingSettled = false;
      await new Promise<void>((resolve) => {
        let timer: any = null;
        const onSeeked = () => {
          this.audioEl.removeEventListener("seeked", onSeeked);
          if (timer) clearTimeout(timer);
          this.isSeekingSettled = true;
          resolve();
        };
        timer = setTimeout(() => {
          this.audioEl.removeEventListener("seeked", onSeeked);
          if (Math.abs(this.audioEl.currentTime - startTime) <= 0.5) {
            this.isSeekingSettled = true;
          }
          resolve();
        }, 1500);
        this.audioEl.addEventListener("seeked", onSeeked);
        this.audioEl.currentTime = startTime;
      });
    }

    if (this.currentPlayRequestId !== requestId) return;

    if (Math.abs(this.audioEl.currentTime - startTime) > 0.5) {
      this.audioEl.currentTime = startTime;
      await new Promise<void>((resolve) => {
        const onSeeked2 = () => {
          this.audioEl.removeEventListener("seeked", onSeeked2);
          resolve();
        };
        const t2 = setTimeout(() => {
          this.audioEl.removeEventListener("seeked", onSeeked2);
          resolve();
        }, 500);
        this.audioEl.addEventListener("seeked", onSeeked2, { once: true });
      });
    }
    if (this.currentPlayRequestId !== requestId) return;
    this.isSeekingSettled = true;

    try {
      await this.audioEl.play();
      if (this.currentPlayRequestId !== requestId) return;
      this.startRafLoop();
      this.startTicker();

      // Arm boundary monitor ONLY AFTER playback successfully starts at the target seek point
      this.currentSegmentStart = startTime;
      this.currentSegmentEnd = endTime;
      this.onSegmentEndCallback = onEnd;

      // Ramp gain up to 1.0 in 15ms after playback successfully starts
      if (this.fadeGainNode && this.audioCtx) {
        const playNow = this.audioCtx.currentTime;
        this.fadeGainNode.gain.cancelScheduledValues(playNow);
        this.fadeGainNode.gain.setValueAtTime(0.0001, playNow);
        this.fadeGainNode.gain.linearRampToValueAtTime(1.0, playNow + 0.015);
      }
    } catch (err) {
      if (this.currentPlayRequestId === requestId) {
        throw err;
      }
    }
  }

  public pause() {
    this.currentPlayRequestId++;
    this.stopRafLoop();
    const currentPauseId = ++this.pauseRequestId;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.isFadingOut = false;

    if (this.fadeGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.fadeGainNode.gain.cancelScheduledValues(now);
      this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, now);
      this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.012);

      // Trigger pause after 15ms micro-fade via Web Worker (immune to Chromium background tab 1000ms throttling)
      if (this.tickerWorker) {
        this.tickerWorker.postMessage({ cmd: "pauseDelay", id: currentPauseId });
      }

      this.pauseTimer = setTimeout(() => {
        if (this.pauseRequestId === currentPauseId) {
          this.audioEl.pause();
          this.stopTicker();
          this.pauseTimer = null;
        }
      }, 15);
    } else {
      this.audioEl.pause();
      this.stopTicker();
    }
  }

  public updateCurrentSegmentBounds(startTime: number, endTime: number) {
    this.currentSegmentStart = startTime;
    this.currentSegmentEnd = endTime;
  }

  public updateCurrentSegmentEnd(endTime: number) {
    this.currentSegmentEnd = endTime;
  }

  public setOnSegmentEnd(cb: (() => void) | null) {
    this.onSegmentEndCallback = cb;
  }

  public async resume(): Promise<boolean> {
    this.pauseRequestId++;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.isFadingOut = false;

    await this.resumeContext();
    try {
      await this.audioEl.play();
      this.startRafLoop();
      this.startTicker();
      if (this.fadeGainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.fadeGainNode.gain.cancelScheduledValues(now);
        this.fadeGainNode.gain.setValueAtTime(0.0001, now);
        this.fadeGainNode.gain.linearRampToValueAtTime(1.0, now + 0.015);
      }
      return true;
    } catch (err) {
      console.warn("[AudioEngine] Resume prevented:", err);
      return false;
    }
  }

  public setVolume(volume: number) {
    // volume between 0 and 1
    const vol = Math.max(0, Math.min(1, volume));
    this.currentVolume = vol;
    this.audioEl.volume = vol;
    if (this.volumeGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.volumeGainNode.gain.cancelScheduledValues(now);
      this.volumeGainNode.gain.setValueAtTime(vol, now);
    }
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public seek(seconds: number) {
    if (this.currentSegmentStart !== null && this.currentSegmentEnd !== null) {
      seconds = Math.max(this.currentSegmentStart, Math.min(seconds, this.currentSegmentEnd));
    }
    this.isFadingOut = false;
    this.pauseRequestId++;
    this.isSeekingSettled = false;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
      this.audioEl.pause();
    }
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }

    if (this.audioEl.paused) {
      if (this.audioEl.readyState === 0) {
        let metaTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          this.isSeekingSettled = true;
          this.activeSeekCleanup = null;
        }, 2000);
        const onLoaded = () => {
          if (metaTimer) {
            clearTimeout(metaTimer);
            metaTimer = null;
          }
          this.audioEl.currentTime = seconds;
          this.isSeekingSettled = true;
          this.activeSeekCleanup = null;
        };
        this.audioEl.addEventListener("loadedmetadata", onLoaded, { once: true });
        this.activeSeekCleanup = () => {
          if (metaTimer) clearTimeout(metaTimer);
          this.audioEl.removeEventListener("loadedmetadata", onLoaded);
          this.activeSeekCleanup = null;
        };
      } else {
        this.audioEl.currentTime = seconds;
        this.isSeekingSettled = true;
      }
      if (this.fadeGainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.fadeGainNode.gain.cancelScheduledValues(now);
        this.fadeGainNode.gain.setValueAtTime(1.0, now);
      }
      return;
    }

    if (this.fadeGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.fadeGainNode.gain.cancelScheduledValues(now);
      this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, now);
      this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.008);

      let seekTimer: any = null;
      const onSeeked = () => {
        this.isSeekingSettled = true;
        if (this.activeSeekCleanup) {
          this.activeSeekCleanup = null;
        }
        this.audioEl.removeEventListener("seeked", onSeeked);
        clearTimeout(fallback);
        if (seekTimer) clearTimeout(seekTimer);
        if (this.fadeGainNode && this.audioCtx && !this.audioEl.paused) {
          const unpauseNow = this.audioCtx.currentTime;
          this.fadeGainNode.gain.cancelScheduledValues(unpauseNow);
          this.fadeGainNode.gain.setValueAtTime(0.0001, unpauseNow);
          this.fadeGainNode.gain.linearRampToValueAtTime(1.0, unpauseNow + 0.015);
        }
      };
      const fallback = setTimeout(onSeeked, 2000);
      this.activeSeekCleanup = () => {
        this.isSeekingSettled = true;
        this.audioEl.removeEventListener("seeked", onSeeked);
        clearTimeout(fallback);
        if (seekTimer) clearTimeout(seekTimer);
        this.activeSeekCleanup = null;
      };
      this.audioEl.addEventListener("seeked", onSeeked);
      this.audioEl.currentTime = seconds;
    } else {
      this.audioEl.currentTime = seconds;
      this.isSeekingSettled = true;
    }
  }

  public unload() {
    this.currentPlayRequestId++;
    this.pauseRequestId++;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }
    this.audioEl.pause();
    this.stopTicker();
    this.stopRafLoop();
    this.currentSegmentStart = null;
    this.currentSegmentEnd = null;
    this.onSegmentEndCallback = null;
    this.isFadingOut = false;
    this.audioEl.removeAttribute("src");
    this.audioEl.load();
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
    if (this.audioEl.paused || this.audioEl.seeking || this.pauseTimer !== null || !this.isSeekingSettled) return;

    const curTime = this.audioEl.currentTime;
    const now = performance.now();

    // Throttle progress callback to 10Hz (every 100ms) to prevent UI re-render thrashing
    if (this.onTimeUpdateCallback && now - this.lastTimeUpdate >= 100) {
      this.lastTimeUpdate = now;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        this.onTimeUpdateCallback(curTime);
      }
    }

    // Guard against seeking settlement lag during same-track segment transitions (both forward & backward)
    if (!this.isSeekingSettled) {
      return;
    }
    if (this.currentSegmentStart !== null && curTime < this.currentSegmentStart - 0.2) {
      return;
    }
    if (this.currentSegmentStart !== null && this.currentSegmentEnd !== null) {
      if (curTime > this.currentSegmentEnd + 1.0 && Math.abs(curTime - this.currentSegmentStart) > 1.0) {
        return;
      }
    }

    if (this.currentSegmentEnd !== null) {
      // Step 1: Pre-fade 60ms before boundary to eliminate DC-offset clicks without bleeding
      // (60ms window ensures a 30ms Web Worker tick NEVER skips the fade)
      const leadTime = 0.060;
      if (curTime >= this.currentSegmentEnd - leadTime && !this.isFadingOut) {
        this.isFadingOut = true;
        if (this.fadeGainNode && this.audioCtx) {
          const fadeNow = this.audioCtx.currentTime;
          const remaining = Math.max(0.012, this.currentSegmentEnd - curTime);
          this.fadeGainNode.gain.cancelScheduledValues(fadeNow);
          this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, fadeNow);
          this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, fadeNow + remaining);
        }
      }

      // Step 2: Boundary reached - pause and advance IMMEDIATELY without setTimeout
      // (immune to Chromium background tab 1000ms timer throttling)
      if (curTime >= this.currentSegmentEnd) {
        this.isFadingOut = false;
        const cb = this.onSegmentEndCallback;
        this.currentSegmentStart = null;
        this.currentSegmentEnd = null;
        this.onSegmentEndCallback = null;

        this.stopTicker();
        this.stopRafLoop();
        this.audioEl.pause();
        if (cb) cb();
      }
    }
  };

  private startRafLoop = () => {
    if (this.animationFrameId !== null) return;
    const loop = () => {
      if (!this.audioEl.paused) {
        this.checkBoundary();
        this.animationFrameId = requestAnimationFrame(loop);
      } else {
        this.animationFrameId = null;
      }
    };
    this.animationFrameId = requestAnimationFrame(loop);
  };

  private stopRafLoop = () => {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  };

  private startTicker = () => {
    if (this.tickerWorker) {
      this.tickerWorker.postMessage("start");
    } else if (!this.fallbackTickerInterval) {
      this.fallbackTickerInterval = setInterval(this.checkBoundary, 30);
    }
  };

  private stopTicker = () => {
    if (this.tickerWorker) {
      this.tickerWorker.postMessage("stop");
    }
    if (this.fallbackTickerInterval) {
      clearInterval(this.fallbackTickerInterval);
      this.fallbackTickerInterval = null;
    }
  };

  /**
   * Monitor currentTime using requestAnimationFrame, supplemented by timeupdate and a controllable Web Worker ticker
   * to ensure background/minimized windows never miss segment boundaries due to Chromium 1000ms timer throttling.
   */
  private startBoundaryMonitor = () => {
    // Native timeupdate listener
    this.audioEl.addEventListener("timeupdate", this.checkBoundary);

    // Controllable Web Worker ticker (not subject to Chromium background tab 1000ms timer throttling)
    try {
      const code = `
        let intervalId = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!intervalId) intervalId = setInterval(function() { postMessage('tick'); }, 30);
          } else if (e.data === 'stop') {
            if (intervalId) { clearInterval(intervalId); intervalId = null; }
          } else if (e.data && e.data.cmd === 'pauseDelay') {
            const id = e.data.id;
            setTimeout(function() { postMessage({ cmd: 'paused', id: id }); }, 15);
          }
        };
      `;
      const blob = new Blob([code], { type: "text/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      this.tickerWorker = new Worker(workerUrl);
      setTimeout(() => {
        try { URL.revokeObjectURL(workerUrl); } catch {}
      }, 3000);

      this.tickerWorker.onmessage = (e) => {
        if (e.data === "tick") {
          this.checkBoundary();
        } else if (e.data && e.data.cmd === "paused") {
          if (e.data.id === this.pauseRequestId && this.pauseTimer !== null) {
            clearTimeout(this.pauseTimer);
            this.pauseTimer = null;
            this.audioEl.pause();
            this.stopTicker();
          }
        }
      };

      this.tickerWorker.onerror = (e) => {
        console.warn("[AudioEngine] Ticker worker error, falling back to interval:", e);
        this.tickerWorker = null;
        if (!this.fallbackTickerInterval && !this.audioEl.paused) {
          this.fallbackTickerInterval = setInterval(this.checkBoundary, 30);
        }
      };
    } catch {
      // Worker not supported, will fallback to interval when active
    }
  };
}

export const audioEngine = new AudioEngine();
