import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import i18n from "../i18n";
import { Navbar } from "./Navbar";
import { usePlayerStore } from "../store/usePlayerStore";
import { useLogStore } from "../store/useLogStore";

async function waitForCondition(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe("Navbar YouTube Ingestion Queue", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;

  let originalStoreState: any;
  let originalLogState: any;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLTextAreaElement = happyWindow.HTMLTextAreaElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    originalFetch = globalThis.fetch;
    originalStoreState = { ...usePlayerStore.getState() };
    originalLogState = { ...useLogStore.getState() };

    usePlayerStore.setState({
      tracks: [],
      playlists: [],
      activePlaylistId: null,
      activePlaylistItems: [],
      activeSystemCategory: undefined,
    });

    useLogStore.setState({
      logs: [],
      unreadErrorCount: 0,
      isDrawerOpen: false,
    });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    usePlayerStore.setState(originalStoreState, true);
    useLogStore.setState(originalLogState, true);
    await i18n.changeLanguage("en");
    await act(async () => {
      root.unmount();
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  const triggerTextareaChange = (el: HTMLTextAreaElement, val: string) => {
    const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
    if (propsKey) {
      (el as any)[propsKey].onChange({ target: { value: val } });
    }
  };

  const submitForm = (btn: HTMLButtonElement) => {
    btn.click();
  };

  const findSubmitBtn = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Add Tracks") || b.textContent?.includes("Nạp bài hát")
    ) as HTMLButtonElement;

  it("should open YouTube modal, allow adding a link, clear textarea immediately, and keep button enabled for next link", async () => {
    let fetchResolve: ((res: Response) => void) | null = null;
    const fetchPromise = new Promise<Response>((resolve) => {
      fetchResolve = resolve;
    });

    let callCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/api/tracks/ingest-youtube")) {
        callCount++;
        if (callCount === 1) {
          return fetchPromise;
        }
        return new Response(JSON.stringify({ success: true, tracks: [{ id: "yt_2" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    // Find and click the "+ Link YouTube" button
    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    expect(ytButton).toBeDefined();

    await act(async () => {
      ytButton?.click();
    });

    // Modal is open, find textarea and submit button
    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    expect(textarea).toBeDefined();

    const getSubmitBtn = () => findSubmitBtn(container);

    expect(getSubmitBtn()).toBeDefined();
    expect(getSubmitBtn().disabled).toBe(true);

    // Type first URL
    await act(async () => {
      triggerTextareaChange(textarea, "https://www.youtube.com/playlist?list=PLtest1");
    });

    const submitBtn = getSubmitBtn();
    expect(submitBtn.disabled).toBe(false);

    // Submit first link
    await act(async () => {
      submitForm(submitBtn);
    });

    // Textarea should be immediately cleared
    const currentTextarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    expect(currentTextarea.value).toBe("");

    // Submit button should be disabled ONLY because textarea is empty, but NOT because YouTube is loading
    expect(getSubmitBtn().disabled).toBe(true);

    // Now immediately type second URL while first URL is still pending
    await act(async () => {
      triggerTextareaChange(currentTextarea, "https://www.youtube.com/playlist?list=PLtest2");
    });

    // The button must NOT be disabled anymore! User can submit playlist 2 immediately!
    expect(getSubmitBtn().disabled).toBe(false);

    // Submit second link
    await act(async () => {
      submitForm(getSubmitBtn());
    });

    // Input cleared again
    const clearedTextarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    expect(clearedTextarea.value).toBe("");

    // Resolve first fetch so the background queue finishes
    await act(async () => {
      fetchResolve?.(new Response(JSON.stringify({ success: true, tracks: [{ id: "yt_1" }] }), { status: 200 }));
    });

    // Deterministically wait until callCount reaches 2 and queue finishes
    await waitForCondition(
      () => callCount === 2 && (/(Processed 2\/2 links|Đã xử lý xong 2\/2 link)/.test(container.textContent || ""))
    );
    expect(callCount).toBe(2);
  });

  it("should support pasting multiple playlist links at once and process them sequentially", async () => {
    const fetchedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/api/tracks/ingest-youtube")) {
        const body = JSON.parse((init?.body as string) || "{}");
        fetchedUrls.push(body.url);
        return new Response(JSON.stringify({ success: true, tracks: [{ id: `yt_${fetchedUrls.length}` }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    const submitBtn = findSubmitBtn(container);

    const multiUrls = `
      https://www.youtube.com/playlist?list=PLalpha
      https://www.youtube.com/playlist?list=PLbeta
      https://www.youtube.com/playlist?list=PLgamma
    `;

    await act(async () => {
      triggerTextareaChange(textarea, multiUrls);
    });

    expect(submitBtn.disabled).toBe(false);

    await act(async () => {
      submitForm(submitBtn);
    });

    // Input immediately clears
    const currentTextarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    expect(currentTextarea.value).toBe("");

    // Wait for sequential queue to finish all 3
    await waitForCondition(
      () => fetchedUrls.length === 3 && (/(Processed 3\/3 links|Đã xử lý xong 3\/3 link)/.test(container.textContent || ""))
    );

    expect(fetchedUrls).toEqual([
      "https://www.youtube.com/playlist?list=PLalpha",
      "https://www.youtube.com/playlist?list=PLbeta",
      "https://www.youtube.com/playlist?list=PLgamma",
    ]);
  });

  it("should allow cancelling in-flight YouTube queue via Hủy quét link button", async () => {
    let abortObserved = false;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/api/tracks/ingest-youtube")) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortObserved = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    await act(async () => {
      triggerTextareaChange(textarea, "https://www.youtube.com/watch?v=slow123");
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    // Wait for cancel button to appear
    await waitForCondition(() =>
      Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Cancel") || b.textContent?.includes("Hủy"))
    );

    const cancelBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancel") || b.textContent?.includes("Hủy")
    ) as HTMLButtonElement;

    expect(cancelBtn).toBeDefined();

    await act(async () => {
      cancelBtn.click();
    });

    // Confirmation popup opens; confirm cancellation
    const confirmStopBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Dừng") || b.textContent?.includes("Stop")
    ) as HTMLButtonElement;
    if (confirmStopBtn) {
      await act(async () => {
        confirmStopBtn.click();
      });
    }

    expect(abortObserved).toBe(true);

    // Queue should reflect cancellation
    await waitForCondition(
      () =>
        (/(Cancelled|Import cancelled|Đã hủy quét link)/.test(container.textContent || "")) &&
        !container.querySelector(".animate-spin")
    );
    expect(container.textContent).toMatch(/Cancelled|Import cancelled|Đã hủy quét link/);
  });

  it("should continue processing subsequent URLs when one URL encounters an error", async () => {
    const fetchedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/api/tracks/ingest-youtube")) {
        const body = JSON.parse((init?.body as string) || "{}");
        fetchedUrls.push(body.url);
        if (body.url.includes("bad_url")) {
          return new Response(JSON.stringify({ success: false, message: "Video không tồn tại" }), { status: 400 });
        }
        return new Response(JSON.stringify({ success: true, tracks: [{ id: "yt_good" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    await act(async () => {
      triggerTextareaChange(textarea, "https://www.youtube.com/watch?v=bad_url\nhttps://www.youtube.com/watch?v=good_url");
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    // Both should be fetched sequentially despite first one failing
    await waitForCondition(
      () =>
        fetchedUrls.length === 2 &&
        (/((\+1 tracks|\+1 bài))/.test(container.textContent || "")) &&
        (container.textContent?.includes("Video không tồn tại") ?? false)
    );
    expect(fetchedUrls).toEqual([
      "https://www.youtube.com/watch?v=bad_url",
      "https://www.youtube.com/watch?v=good_url",
    ]);

    expect(container.textContent).toContain("Video không tồn tại");
    expect(container.textContent).toMatch(/\+1 tracks|\+1 bài/);
  });

  it("should reject batch when exceeding 50 URLs with a friendly error", async () => {
    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    const urls = Array.from({ length: 55 }, (_, i) => `https://www.youtube.com/watch?v=id_${i}`).join("\n");

    await act(async () => {
      triggerTextareaChange(textarea, urls);
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    expect(container.textContent).toMatch(/Maximum 50 links allowed|Chỉ được nạp tối đa 50 đường link/);
  });

  it("should show error feedback when submitting duplicate URLs that are already active in queue", async () => {
    // Keep fetch pending
    let fetchResolve: ((res: Response) => void) | null = null;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        fetchResolve = resolve;
      })) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    await act(async () => {
      triggerTextareaChange(textarea, "https://www.youtube.com/watch?v=dup123");
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    // Try submitting the same URL while it is active
    await act(async () => {
      triggerTextareaChange(textarea, "https://www.youtube.com/watch?v=dup123");
    });

    await act(async () => {
      submitForm(submitBtn);
    });

    // Should display feedback instead of silently dropping
    expect(container.textContent).toMatch(/already queued|đã có trong hàng đợi/);

    // Clean up pending fetch
    await act(async () => {
      fetchResolve?.(new Response(JSON.stringify({ success: true, tracks: [] }), { status: 200 }));
    });
  });

  it("should sanitize trailing punctuation from URLs and display accurate header on mixed outcomes", async () => {
    const fetchedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/api/tracks/ingest-youtube")) {
        const body = JSON.parse((init?.body as string) || "{}");
        fetchedUrls.push(body.url);
        if (body.url.includes("fail")) {
          return new Response(JSON.stringify({ success: false, message: "Lỗi tải video" }), { status: 400 });
        }
        return new Response(JSON.stringify({ success: true, tracks: [{ id: "track_ok" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    // Input containing trailing punctuation like periods or markdown brackets
    const rawInput = "Check: <https://www.youtube.com/watch?v=pass123.> and [link](https://www.youtube.com/watch?v=fail456!)";

    await act(async () => {
      triggerTextareaChange(textarea, rawInput);
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    await waitForCondition(
      () =>
        fetchedUrls.length === 2 &&
        (/(Completed: 1\/2|Hoàn tất: 1\/2)/.test(container.textContent || ""))
    );

    // Trailing period and exclamation mark should be stripped
    expect(fetchedUrls).toEqual([
      "https://www.youtube.com/watch?v=pass123",
      "https://www.youtube.com/watch?v=fail456",
    ]);

    expect(container.textContent).toMatch(/Completed: 1\/2|Hoàn tất: 1\/2/);
  });

  it("should reject invalid input or non-YouTube URLs with user-friendly error", async () => {
    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    await act(async () => {
      triggerTextareaChange(textarea, "https://example.com/not-youtube and some random text");
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    expect(container.textContent).toMatch(/No valid YouTube URL found|Không tìm thấy đường link YouTube hợp lệ/);
  });

  it("should accept protocol-less YouTube and youtu.be shortlinks", async () => {
    const fetchedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/api/tracks/ingest-youtube")) {
        const body = JSON.parse((init?.body as string) || "{}");
        fetchedUrls.push(body.url);
        return new Response(JSON.stringify({ success: true, tracks: [{ id: "track_short" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    await act(async () => {
      root.render(<Navbar searchQuery="" onSearchChange={() => {}} />);
    });

    const ytButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("YouTube")
    );
    await act(async () => {
      ytButton?.click();
    });

    const textarea = container.querySelector("textarea[placeholder*='youtube.com']") as HTMLTextAreaElement;
    await act(async () => {
      triggerTextareaChange(textarea, "Check: youtu.be/abc1234");
    });

    const submitBtn = findSubmitBtn(container);

    await act(async () => {
      submitForm(submitBtn);
    });

    await waitForCondition(
      () =>
        fetchedUrls.length === 1 &&
        (/(Processed 1\/1 links|Đã xử lý xong 1\/1 link)/.test(container.textContent || ""))
    );

    expect(fetchedUrls).toEqual(["https://youtu.be/abc1234"]);
  });

  it("should render the language switcher button and toggle language between en and vi", async () => {
    await i18n.changeLanguage("en");
    await act(async () => {
      root.render(
        <Navbar
          onSearchChange={() => {}}
          searchQuery=""
        />
      );
    });

    const langBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().toLowerCase() === "en" || b.textContent?.trim().toLowerCase() === "vi"
    );
    expect(langBtn).toBeDefined();
    expect(langBtn?.textContent?.trim().toUpperCase()).toBe("EN");

    await act(async () => {
      langBtn?.click();
    });

    expect(langBtn?.textContent?.trim().toUpperCase()).toBe("VI");
    expect(i18n.language.startsWith("vi")).toBe(true);

    await i18n.changeLanguage("en");
  });
});
