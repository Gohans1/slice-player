import { GlobalWindow } from "happy-dom";

// Preloaded by bunfig.toml so a DOM exists before any module loads. React DOM and
// Base UI read `window`/`document` at import time (canUseDOM, useIsoLayoutEffect);
// without this, onChange never fires and Base UI popups never mount in tests.
export const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });

// Fill in browser globals Bun lacks; keep Bun's own (fetch, Response, Blob, URL, ...)
// so server tests keep running against the real runtime.
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (key in globalThis) continue;
  const value: unknown = Reflect.get(happyWindow, key);
  Reflect.set(globalThis, key, typeof value === "function" && /^[a-z]/.test(key) ? value.bind(happyWindow) : value);
}

Object.assign(globalThis, { window: happyWindow, document: happyWindow.document, IS_REACT_ACT_ENVIRONMENT: true });
