/**
 * Audio Engine with Web Audio API GainNode Micro-Fade
 * Eliminates all DC-offset clicks and pops when seeking or transitioning segments.
 */

import { logClientError } from "../store/useLogStore";

export function volumeToGain(volume: number): number {
  const safe = typeof volume === "number" && Number.isFinite(volume)
    ? Math.max(0, Math.min(1, volume))
    : 0.5;
  return Math.pow(safe, 2);
}

/** Final output gain: per-track level and global master level, each on the perceptual curve. */
export function outputGain(trackVolume: number, masterVolume: number): number {
  return volumeToGain(trackVolume) * volumeToGain(masterVolume);
}

// An equal-power fade (Boris Smus, Web Audio API ch. 3): as one song fades out and the next fades in, their summed power
// stays even, with no dip halfway as a linear crossfade has
function equalPowerFade(direction: "in" | "out", from = 1): Float32Array {
  const steps = 64;
  return Float32Array.from({ length: steps }, (_, i) => {
    const angle = (i / (steps - 1)) * (Math.PI / 2);
    return direction === "in" ? Math.sin(angle) : from * Math.cos(angle);
  });
}

// One <audio> and its gain nodes. A crossfade plays two at once: the song fading out keeps its own level
interface Deck {
  el: HTMLAudioElement;
  fade: GainNode | null;
  volume: GainNode | null;
}

class AudioEngine {
  private audioEl: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private fadeGainNode: GainNode | null = null;
  private volumeGainNode: GainNode | null = null;
  private currentVolume = 0.5;
  private masterVolume = 0.5;
  private soundCheckGain = 1;
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
  private fadeStartTime = 0;
  private tickerWorker: Worker | null = null;
  private fallbackTickerInterval: ReturnType<typeof setInterval> | null = null;
  private onErrorCallback: ((err: MediaError | null) => void) | null = null;
  private onBufferingCallback: ((isBuffering: boolean) => void) | null = null;
  private isUnloading = false;

  // Crossfade: near a song's end the engine asks for the next one, which starts on the other deck as this one fades out
  private crossfadeSeconds = 0;
  private onCrossfadeCallback: (() => void) | null = null;
  private isCrossfadeAsked = false;
  // The next song is being started from the crossfade callback, so it goes on the other deck
  private isHandingOver = false;
  private spareDeck: Deck | null = null;
  private fadingDeck: { deck: Deck; timer: ReturnType<typeof setTimeout> } | null = null;

  public setOnErrorCallback(cb: ((err: MediaError | null) => void) | null) {
    this.onErrorCallback = cb;
  }

  public setOnBufferingCallback(cb: ((isBuffering: boolean) => void) | null) {
    this.onBufferingCallback = cb;
  }

  public getContextState(): AudioContextState | null {
    return this.audioCtx ? this.audioCtx.state : null;
  }

  constructor() {
    if (typeof Audio !== "undefined") {
      this.audioEl = this.createAudioElement();
    } else {
      this.audioEl = {
        crossOrigin: "",
        preload: "",
        paused: true,
        currentTime: 0,
        src: "",
        addEventListener() {},
        removeEventListener() {},
        pause() {},
        play() {
          if (!this.src) return Promise.reject(new Error("No src"));
          return Promise.resolve();
        },
        load() {},
        removeAttribute(attr: string) {
          if (attr === "src") this.src = "";
        },
      } as any;
    }

    if (typeof window !== "undefined") {
      const resumeOnGesture = () => {
        this.init();
        this.resumeContext();
        if (this.audioCtx && this.audioCtx.state === "running") {
          window.removeEventListener("pointerdown", resumeOnGesture);
          window.removeEventListener("keydown", resumeOnGesture);
        }
      };
      window.addEventListener("pointerdown", resumeOnGesture);
      window.addEventListener("keydown", resumeOnGesture);
    }
  }

  // The engine's <audio>, which reports only while it is the one playing: a song fading out has nothing to tell
  private createAudioElement(): HTMLAudioElement {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.addEventListener("waiting", () => {
      if (el === this.audioEl) this.onBufferingCallback?.(true);
    });
    el.addEventListener("playing", () => {
      if (el === this.audioEl) this.onBufferingCallback?.(false);
    });
    el.addEventListener("pause", () => {
      if (el === this.audioEl) this.onBufferingCallback?.(false);
    });
    el.addEventListener("error", () => {
      if (el !== this.audioEl) return;
      this.stopTicker();
      this.stopRafLoop();
      this.isFadingOut = false;

      // Ignore error events fired during intentional unload or when src is empty
      if (this.isUnloading || !this.audioEl.src || (typeof window !== "undefined" && this.audioEl.src === window.location.href)) {
        return;
      }

      const err = this.audioEl.error;
      // Code 1 is MEDIA_ERR_ABORTED - triggered during normal track switching or pauses
      if (err?.code === 1) {
        return;
      }

      let msg = "Browser audio playback error";
      if (err) {
        switch (err.code) {
          case 2: msg = "Network error while streaming audio (MEDIA_ERR_NETWORK)"; break;
          case 3: msg = "Audio decoding error (MEDIA_ERR_DECODE)"; break;
          case 4: msg = "Format not supported or 404 (MEDIA_ERR_SRC_NOT_SUPPORTED)"; break;
        }
      }
      if (this.onErrorCallback) {
        this.onErrorCallback(err);
      } else {
        logClientError("playback", msg, { code: err?.code, message: err?.message, src: this.audioEl.src });
      }
    });
    return el;
  }

  public init() {
    if (typeof window === "undefined" || this.isInitialized) return;
    this.isInitialized = true;

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      ({ fade: this.fadeGainNode, volume: this.volumeGainNode } = this.connectDeck(this.audioEl));
    } catch (e) {
      console.warn("[AudioEngine] Web Audio graph init fallback to direct audio element", e);
    }

    this.watchPlayback(this.audioEl);
    this.initTickerWorker();
  }

  // Two-stage gain graph for each deck:
  // [source] -> [fade] (0.0001 <-> 1.0 micro-fades and crossfades) -> [volume] (user volume) -> [destination]
  private connectDeck(el: HTMLAudioElement): { fade: GainNode; volume: GainNode } {
    const ctx = this.audioCtx!;
    const source = ctx.createMediaElementSource(el);
    const fade = ctx.createGain();
    fade.gain.value = 1.0;
    const volume = ctx.createGain();
    volume.gain.value = outputGain(this.currentVolume, this.masterVolume) * this.soundCheckGain;
    source.connect(fade);
    fade.connect(volume);
    volume.connect(ctx.destination);
    el.volume = 1.0;
    return { fade, volume };
  }

  // A deck's end and progress count while it is the one playing. Boundaries are also checked every animation frame and on
  // a Web Worker tick, so Chromium's 1000ms timer throttling of a background window never misses one
  private watchPlayback(el: HTMLAudioElement) {
    el.addEventListener("ended", () => {
      if (el !== this.audioEl) return;
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
    el.addEventListener("timeupdate", this.checkBoundary);
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

  private cancelFadeGain(time: number) {
    if (!this.fadeGainNode) return;
    const gain = this.fadeGainNode.gain;
    if (typeof (gain as any).cancelAndHoldAtTime === "function") {
      (gain as any).cancelAndHoldAtTime(time);
    } else {
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(gain.value, time);
    }
  }

  public setCrossfade(seconds: number) {
    this.crossfadeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  // Asked once per song, as its crossfade begins: starting the next song from here crosses into it
  public setOnCrossfade(cb: (() => void) | null) {
    this.onCrossfadeCallback = cb;
  }

  // How long the playing song and the next overlap: at most half the song, so a short slice is mostly heard alone
  private crossfadeLength(): number {
    if (!this.audioCtx || this.crossfadeSeconds <= 0 || this.currentSegmentStart === null || this.currentSegmentEnd === null) return 0;
    return Math.min(this.crossfadeSeconds, (this.currentSegmentEnd - this.currentSegmentStart) / 2);
  }

  // The playing song fades out to its end on its own deck, and the other deck becomes the one playing.
  // Returns how long the next song fades in, or 0 when there is no crossing
  private beginCrossfade(): number {
    this.isHandingOver = false;
    const length = this.crossfadeLength();
    const end = this.currentSegmentEnd;
    if (length <= 0 || end === null || !this.audioCtx || !this.fadeGainNode) return 0;
    if (!this.spareDeck) {
      const el = this.createAudioElement();
      this.spareDeck = { el, ...this.connectDeck(el) };
      this.watchPlayback(el);
    }
    const outgoing: Deck = { el: this.audioEl, fade: this.fadeGainNode, volume: this.volumeGainNode };
    const fadeOut = Math.max(0.05, end - this.audioEl.currentTime);
    const now = this.audioCtx.currentTime;
    const from = this.fadeGainNode.gain.value;
    this.cancelFadeGain(now);
    this.fadeGainNode.gain.setValueCurveAtTime(equalPowerFade("out", from), now, fadeOut);
    this.fadingDeck = { deck: outgoing, timer: setTimeout(() => this.stopFadingDeck(0), fadeOut * 1000 + 20) };

    ({ el: this.audioEl, fade: this.fadeGainNode, volume: this.volumeGainNode } = this.spareDeck);
    this.spareDeck = null;
    this.applyGain();
    return length;
  }

  // Stops the song fading out, at once or after a short ramp when it can still be heard; its deck is spare again
  private stopFadingDeck(rampSeconds: number) {
    const fading = this.fadingDeck;
    if (!fading) return;
    this.fadingDeck = null;
    clearTimeout(fading.timer);
    const { deck } = fading;
    if (rampSeconds > 0 && deck.fade && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      deck.fade.gain.cancelScheduledValues(now);
      deck.fade.gain.setValueAtTime(deck.fade.gain.value, now);
      deck.fade.gain.linearRampToValueAtTime(0.0001, now + rampSeconds);
      // A crossing begun before this runs has made the deck the playing one again
      setTimeout(() => {
        if (deck.el !== this.audioEl) deck.el.pause();
      }, rampSeconds * 1000 + 5);
    } else {
      deck.el.pause();
    }
    this.spareDeck = deck;
  }

  public setSource(streamUrl: string) {
    this.init();
    this.audioEl.src = streamUrl;
  }

  public async playSegment(
    streamUrl: string,
    startTime: number,
    endTime: number,
    onEnd: () => void,
    onTimeUpdate?: (t: number) => void,
    segmentStartTime?: number
  ) {
    const requestId = ++this.currentPlayRequestId;
    this.init();
    // Started from the crossfade callback, the song crosses in; any other start cuts off a song still fading out
    const fadeIn = this.isHandingOver ? this.beginCrossfade() : 0;
    if (!fadeIn) this.stopFadingDeck(0.015);
    await this.resumeContext();
    if (this.currentPlayRequestId !== requestId) return;

    this.pauseRequestId++;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }
    this.isFadingOut = false;

    // Disarm boundary checks during load and seek transition
    this.currentSegmentStart = null;
    this.currentSegmentEnd = null;
    this.onSegmentEndCallback = null;
    this.onTimeUpdateCallback = onTimeUpdate || null;

    // Soft fade-out current audio before loading new track or seeking
    if (this.fadeGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.cancelFadeGain(now);
      this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.015);
    }

    // Await micro-fade completion if playing before changing source or seeking
    if (!this.audioEl.paused && this.fadeGainNode && this.audioCtx) {
      await new Promise((r) => setTimeout(r, 16));
    }

    // Check if same track is already loaded
    const baseUrl = typeof window !== "undefined" && window.location ? window.location.href : "http://localhost";
    const isSameSource = this.audioEl.src === new URL(streamUrl, baseUrl).href;

    if (!isSameSource) {
      if (this.currentPlayRequestId !== requestId) return;
      this.audioEl.src = streamUrl;
      await new Promise<void>((resolve, reject) => {
        let isDone = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = () => {
          if (isDone) return;
          isDone = true;
          this.audioEl.removeEventListener("canplay", onCanPlay);
          this.audioEl.removeEventListener("error", onError);
          if (timer) clearTimeout(timer);
        };
        const onCanPlay = () => { cleanup(); resolve(); };
        const onError = () => {
          cleanup();
          if (this.currentPlayRequestId === requestId) {
            const err = this.audioEl.error;
            let detailMsg = "Audio load failed or 404";
            if (err?.code === 2) detailMsg = "Network error while streaming audio (MEDIA_ERR_NETWORK)";
            else if (err?.code === 3) detailMsg = "Audio decoding error (MEDIA_ERR_DECODE)";
            else if (err?.code === 4) detailMsg = "Format not supported or 404 (MEDIA_ERR_SRC_NOT_SUPPORTED)";
            const customErr: any = new Error(detailMsg);
            customErr.code = err?.code;
            customErr.src = this.audioEl.src;
            reject(customErr);
          } else {
            resolve();
          }
        };
        timer = setTimeout(() => {
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
        let t2: any = null;
        const onSeeked2 = () => {
          if (t2) clearTimeout(t2);
          this.audioEl.removeEventListener("seeked", onSeeked2);
          resolve();
        };
        t2 = setTimeout(() => {
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
      this.currentSegmentStart = typeof segmentStartTime === "number" && Number.isFinite(segmentStartTime)
        ? segmentStartTime
        : startTime;
      this.currentSegmentEnd = endTime;
      this.onSegmentEndCallback = onEnd;
      this.isCrossfadeAsked = false;

      // Ramp gain up to 1.0 in 15ms after playback successfully starts, or over the crossfade
      if (this.fadeGainNode && this.audioCtx) {
        const playNow = this.audioCtx.currentTime;
        this.cancelFadeGain(playNow);
        if (fadeIn > 0) {
          this.fadeGainNode.gain.setValueCurveAtTime(equalPowerFade("in"), playNow, fadeIn);
        } else {
          this.fadeGainNode.gain.setValueAtTime(0.0001, playNow);
          this.fadeGainNode.gain.linearRampToValueAtTime(1.0, playNow + 0.015);
        }
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
    this.stopFadingDeck(0.012);
    const currentPauseId = ++this.pauseRequestId;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.isFadingOut = false;

    if (this.fadeGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.cancelFadeGain(now);
      this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.012);

      // Trigger pause after 15ms micro-fade via Web Worker (immune to Chromium background tab 1000ms throttling)
      if (this.tickerWorker) {
        this.tickerWorker.postMessage({ cmd: "manualPauseDelay", id: currentPauseId });
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

  /** true: resumed; false: needs reload fallback; null: cancelled by a newer intent. */
  public async resume(): Promise<boolean | null> {
    const requestId = ++this.currentPlayRequestId;
    this.pauseRequestId++;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.isFadingOut = false;
    // Nothing loaded (unloaded, or a queue restored on startup): play() would wait for a source that never comes
    if (!this.audioEl.src) return false;

    await this.resumeContext();
    if (this.currentPlayRequestId !== requestId) return null;
    try {
      await this.audioEl.play();
      if (this.currentPlayRequestId !== requestId) return null;
      this.startRafLoop();
      this.startTicker();
      if (this.fadeGainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.cancelFadeGain(now);
        this.fadeGainNode.gain.setValueAtTime(0.0001, now);
        this.fadeGainNode.gain.linearRampToValueAtTime(1.0, now + 0.015);
      }
      return true;
    } catch (err) {
      if (this.currentPlayRequestId !== requestId) return null;
      console.warn("[AudioEngine] Resume prevented:", err);
      return false;
    }
  }

  public setVolume(volume: number) {
    // volume between 0 and 1
    const vol = typeof volume === "number" && Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0.5;
    this.currentVolume = vol;
    this.applyGain();
  }

  public setMasterVolume(volume: number) {
    this.masterVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
    this.applyGain();
  }

  // The playing song's Sound Check gain, which can raise a quiet song past unity
  public setSoundCheckGain(gain: number) {
    this.soundCheckGain = Number.isFinite(gain) && gain > 0 ? gain : 1;
    this.applyGain();
  }

  private applyGain() {
    // The next song's volume, set before it crosses in, is for its deck: the song fading out keeps its own
    if (this.isHandingOver) return;
    const gainVal = outputGain(this.currentVolume, this.masterVolume) * this.soundCheckGain;
    if (this.volumeGainNode && this.audioCtx) {
      this.audioEl.volume = 1.0;
      const now = this.audioCtx.currentTime;
      this.volumeGainNode.gain.cancelScheduledValues?.(now);
      this.volumeGainNode.gain.setValueAtTime?.(gainVal, now);
    } else {
      this.audioEl.volume = Math.min(1, gainVal);
    }
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public seek(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.isSeekingSettled = false;
    this.stopFadingDeck(0.012);
    // Seeking back before the crossfade asks for the next song again when it gets there
    this.isCrossfadeAsked = false;

    // Disarm previous seek listener and timeout
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }

    this.isFadingOut = false;
    this.pauseRequestId++;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
      this.audioEl.pause();
    }

    if (this.currentSegmentStart !== null && this.currentSegmentEnd !== null) {
      seconds = Math.max(
        this.currentSegmentStart,
        Math.min(this.currentSegmentEnd, seconds)
      );
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
        this.fadeGainNode.gain.setValueAtTime(0.0001, now);
      }
      return;
    }

    if (this.fadeGainNode && this.audioCtx && !this.audioEl.paused) {
      const now = this.audioCtx.currentTime;
      this.fadeGainNode.gain.cancelScheduledValues(now);
      this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, now);
      this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.010);

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

      // Wait 10ms for micro-fade to render to zero before setting decoder currentTime
      seekTimer = setTimeout(() => {
        if (!this.isSeekingSettled) {
          this.audioEl.currentTime = seconds;
        }
      }, 10);
    } else {
      this.audioEl.currentTime = seconds;
      this.isSeekingSettled = true;
    }
  }

  public unload() {
    this.isUnloading = true;
    try {
      this.currentPlayRequestId++;
      this.pauseRequestId++;
      if (this.pauseTimer) {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = null;
      }
      if (this.activeSeekCleanup) {
        this.activeSeekCleanup();
      }
      this.stopFadingDeck(0);
      this.audioEl.pause();
      this.stopTicker();
      this.stopRafLoop();
      this.currentSegmentStart = null;
      this.currentSegmentEnd = null;
      this.onSegmentEndCallback = null;
      this.isFadingOut = false;
      if (typeof this.audioEl.removeAttribute === "function") {
        this.audioEl.removeAttribute("src");
      } else {
        this.audioEl.src = "";
      }
      if (typeof this.audioEl.load === "function") {
        this.audioEl.load();
      }
    } finally {
      this.isUnloading = false;
    }
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

    // Throttle progress callback to 10Hz (every 100ms) to prevent UI re-render thrashing. It carries on while the window is
    // hidden, as the music does; what's worth drawing then is the caller's to decide
    if (this.onTimeUpdateCallback && now - this.lastTimeUpdate >= 100) {
      this.lastTimeUpdate = now;
      this.onTimeUpdateCallback(curTime);
    }

    // Guard against seeking settlement lag during same-track segment transitions (both forward & backward)
    if (!this.isSeekingSettled) {
      return;
    }
    if (this.currentSegmentStart !== null && curTime < this.currentSegmentStart - 0.2) {
      return;
    }

    if (this.currentSegmentEnd !== null) {
      const crossfade = this.crossfadeLength();
      if (crossfade > 0 && this.onCrossfadeCallback && !this.isCrossfadeAsked && curTime >= this.currentSegmentEnd - crossfade) {
        this.isCrossfadeAsked = true;
        this.isHandingOver = true;
        try {
          this.onCrossfadeCallback();
        } finally {
          this.isHandingOver = false;
        }
        // The next song crossed in: this deck is fading out on its own
        if (this.fadingDeck) return;
      }

      // Step 1: Pre-fade 60ms before boundary to eliminate DC-offset clicks without bleeding
      // (60ms window ensures a 30ms Web Worker tick NEVER skips the fade)
      const leadTime = 0.060;
      if (curTime >= this.currentSegmentEnd - leadTime && !this.isFadingOut) {
        this.isFadingOut = true;
        this.fadeStartTime = performance.now();
        if (this.fadeGainNode && this.audioCtx) {
          const fadeNow = this.audioCtx.currentTime;
          const remaining = Math.max(0.015, this.currentSegmentEnd - curTime);
          this.fadeGainNode.gain.cancelScheduledValues(fadeNow);
          this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, fadeNow);
          this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, fadeNow + remaining);
        }
      }

      // Step 2: Boundary reached - guarantee fade has rendered before pausing
      if (curTime >= this.currentSegmentEnd) {
        const wasFading = this.isFadingOut;
        const elapsedFadeMs = wasFading ? performance.now() - this.fadeStartTime : 0;
        this.isFadingOut = false;
        const cb = this.onSegmentEndCallback;
        this.currentSegmentStart = null;
        this.currentSegmentEnd = null;
        this.onSegmentEndCallback = null;

        this.stopTicker();
        this.stopRafLoop();

        let transitioned = false;
        const finishTransition = () => {
          if (transitioned) return;
          transitioned = true;
          this.onSegmentEndCallback = null;
          if (this.pauseTimer !== null) {
            clearTimeout(this.pauseTimer);
            this.pauseTimer = null;
          }
          this.audioEl.pause();
          this.stopTicker();
          this.stopRafLoop();
          if (cb) cb();
        };

        const neededRampDelay = Math.max(0, 16 - elapsedFadeMs);
        if (neededRampDelay > 0 && this.fadeGainNode && this.audioCtx && !this.audioEl.paused) {
          const fadeNow = this.audioCtx.currentTime;
          this.fadeGainNode.gain.cancelScheduledValues(fadeNow);
          this.fadeGainNode.gain.setValueAtTime(this.fadeGainNode.gain.value, fadeNow);
          this.fadeGainNode.gain.linearRampToValueAtTime(0.0001, fadeNow + (neededRampDelay / 1000));
          if (this.tickerWorker) {
            const currentPauseId = ++this.pauseRequestId;
            this.onSegmentEndCallback = finishTransition;
            this.tickerWorker.postMessage({ cmd: "pauseDelay", id: currentPauseId });
            this.pauseTimer = setTimeout(() => {
              if (this.pauseRequestId === currentPauseId) {
                finishTransition();
              }
            }, neededRampDelay);
          } else {
            setTimeout(finishTransition, neededRampDelay);
          }
        } else {
          finishTransition();
        }
      }
    }
  };

  private startRafLoop = () => {
    if (this.animationFrameId !== null) return;
    const scheduleNext = (cb: () => void) => {
      return typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(cb)
        : (setTimeout(cb, 16) as any);
    };
    const loop = () => {
      if (!this.audioEl.paused) {
        this.checkBoundary();
        this.animationFrameId = scheduleNext(loop);
      } else {
        this.animationFrameId = null;
      }
    };
    this.animationFrameId = scheduleNext(loop);
  };

  private stopRafLoop = () => {
    if (this.animationFrameId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.animationFrameId);
      } else {
        clearTimeout(this.animationFrameId);
      }
      this.animationFrameId = null;
    }
  };

  private startTicker = () => {
    if (!this.tickerWorker) {
      this.initTickerWorker();
    }
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

  private initTickerWorker = () => {
    if (this.tickerWorker) return;
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
      try { URL.revokeObjectURL(workerUrl); } catch {}

      this.tickerWorker.onmessage = (e) => {
        if (e.data === "tick") {
          this.checkBoundary();
        } else if (e.data && e.data.cmd === "paused") {
          if (e.data.id === this.pauseRequestId) {
            if (this.onSegmentEndCallback) {
              const cb = this.onSegmentEndCallback;
              this.onSegmentEndCallback = null;
              cb();
            } else {
              if (this.pauseTimer !== null) {
                clearTimeout(this.pauseTimer);
                this.pauseTimer = null;
              }
              this.audioEl.pause();
              this.stopTicker();
            }
          }
        }
      };

      this.tickerWorker.onerror = (e) => {
        console.warn("[AudioEngine] Ticker worker error, falling back to interval:", e);
        try { this.tickerWorker?.terminate(); } catch {}
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
