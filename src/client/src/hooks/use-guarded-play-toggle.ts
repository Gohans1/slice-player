import * as React from "react";
import { usePlayerStore, type PlayerState } from "../store/usePlayerStore";

// A second click this soon after starting playback is a double click, not a request to pause
const REPEAT_CLICK_WINDOW_MS = 600;
const TOGGLE_COOLDOWN_MS = 300;
const PLAY_COOLDOWN_MS = 500;

// Starts playing an item, or pauses and resumes it once it's active, ignoring rapid repeat clicks
export function useGuardedPlayToggle(isActive: (state: PlayerState) => boolean, play: () => unknown) {
  const isBusyRef = React.useRef(false);
  const lastPlayStartedRef = React.useRef(0);

  return async () => {
    const store = usePlayerStore.getState();

    if (isActive(store)) {
      if (Date.now() - lastPlayStartedRef.current < REPEAT_CLICK_WINDOW_MS || isBusyRef.current) return;
      isBusyRef.current = true;
      setTimeout(() => {
        isBusyRef.current = false;
      }, TOGGLE_COOLDOWN_MS);
      if (store.isPlaying) {
        store.pause();
      } else {
        await store.resume();
      }
      return;
    }

    if (isBusyRef.current) return;
    isBusyRef.current = true;
    lastPlayStartedRef.current = Date.now();
    try {
      await play();
    } finally {
      setTimeout(() => {
        isBusyRef.current = false;
      }, PLAY_COOLDOWN_MS);
    }
  };
}
