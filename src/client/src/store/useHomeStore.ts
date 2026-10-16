import { create } from "zustand";
import type { HomeSummary } from "@/server/types";

interface HomeState {
  // Kept between visits, so going back to Home shows its shelves at once while they refresh
  summary: HomeSummary | null;
  failed: boolean;
  refresh: () => Promise<void>;
}

let latestRequest = 0;

export const useHomeStore = create<HomeState>()((set) => ({
  summary: null,
  failed: false,
  refresh: async () => {
    const request = ++latestRequest;
    try {
      const res = await fetch("/api/home");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const summary: HomeSummary = await res.json();
      if (request === latestRequest) set({ summary, failed: false });
    } catch (e) {
      console.error("[Home] Failed to load listening history:", e);
      if (request === latestRequest) set({ failed: true });
    }
  },
}));
