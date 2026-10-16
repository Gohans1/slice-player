import { expect, test, type Locator, type Page } from "@playwright/test";
import { makeTracks, mockLibrary } from "./mock-library";

// The library toolbar sticks to the top of the page and the player capsule floats at its foot, both over the content.
// Content that takes focus is scrolled clear of them (clear-sticky-bars in index.css), while focusing the bars' own
// controls must leave the page where it is.

type Box = { x: number; y: number; width: number; height: number };

const toolbar = (page: Page) => page.getByTestId("sticky-library-header");
const capsule = (page: Page) => page.getByRole("region", { name: "Player" });

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not laid out");
  return box;
}

const scrollTo = (page: Page, y: number) => page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);

// A row's "..." button that sits where `isAt` says. Rows are virtualized and move in the DOM as the page scrolls, so the
// button is found again by its name rather than by its place among the rows.
async function rowButton(page: Page, isAt: (box: Box) => boolean): Promise<Locator> {
  const buttons = await page.locator("#main-library-panel [role='row']").getByRole("button", { name: /^More options for / }).all();
  const placed = await Promise.all(buttons.map(async (button) => ({ box: await button.boundingBox(), name: await button.getAttribute("aria-label") })));
  const found = placed.find(({ box, name }) => box && name && isAt(box));
  if (!found?.name) throw new Error("no row button there");
  return page.getByRole("button", { name: found.name, exact: true });
}

test.beforeEach(async ({ page }) => {
  await mockLibrary(page, { tracks: makeTracks(200) });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "More options for Track 001", exact: true })).toBeVisible();
});

test("scrolls a focused row out from under the player", async ({ page }) => {
  await scrollTo(page, 2000);
  const { y: capsuleTop, height: capsuleHeight } = await boxOf(capsule(page));
  const covered = await rowButton(page, (box) => box.y + box.height > capsuleTop && box.y < capsuleTop + capsuleHeight);

  await covered.focus();

  await expect.poll(async () => { const box = await boxOf(covered); return box.y + box.height; }).toBeLessThanOrEqual(capsuleTop);
});

test("scrolls a focused row out from under the toolbar", async ({ page }) => {
  await scrollTo(page, 2000);
  const toolbarBottom = await boxOf(toolbar(page)).then((box) => box.y + box.height);
  const covered = await rowButton(page, (box) => box.y < toolbarBottom && box.y + box.height > 0);

  await covered.focus();

  await expect.poll(async () => (await boxOf(covered)).y).toBeGreaterThanOrEqual(toolbarBottom);
});

test("leaves the page where it is when the toolbar's or the player's own controls take focus", async ({ page }) => {
  await scrollTo(page, 2000);

  // Focus scrolls at once, so each control's scroll is read straight after focusing it
  const { focused, moved } = await page.evaluate(() => {
    const bars = document.querySelectorAll("[data-testid='sticky-library-header'], section[aria-label='Player']");
    const controls = [...bars].flatMap((bar) => [...bar.querySelectorAll<HTMLButtonElement>("button")]).filter((b) => b.checkVisibility());
    const start = window.scrollY;
    const movers = controls.filter((control) => {
      control.focus();
      return window.scrollY !== start;
    });
    return { focused: controls.length, moved: movers.map((b) => b.getAttribute("aria-label") ?? b.textContent) };
  });

  expect(moved).toEqual([]);
  expect(focused).toBeGreaterThan(3);
});
