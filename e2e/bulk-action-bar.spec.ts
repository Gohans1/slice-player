import { expect, test, type Locator, type Page } from "@playwright/test";
import { makeTracks, mockLibrary, openLibraryPage } from "./mock-library";

// Selecting rows brings up the bulk action bar. It floats just above the player capsule and centred on it, wherever
// the main column sits between the sidebar and the queue panel and however short the list is.

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not laid out");
  return box;
}

const bulkBar = (page: Page) => page.getByRole("complementary", { name: "Bulk actions" });
const player = (page: Page) => page.getByRole("region", { name: "Player" });
const centreOf = async (locator: Locator) => boxOf(locator).then((box) => box.x + box.width / 2);

// Serves a library of that many tracks and selects the first two, the way phones have too: Select in a row's "..."
// menu, then tapping rows adds them
async function selectTwoOf(page: Page, trackCount: number) {
  await mockLibrary(page, { tracks: makeTracks(trackCount) });
  await page.goto("/");
  await openLibraryPage(page, "Mix");
  await page.getByRole("button", { name: "More options for Track 001", exact: true }).click();
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await page.getByRole("row", { name: "Select Track 002", exact: true }).click();
  await expect(bulkBar(page)).toContainText("2");
}

async function expectCentredAbovePlayer(page: Page) {
  // Read once the bar has finished sliding in
  await expect(async () => {
    const [bar, capsule] = await Promise.all([boxOf(bulkBar(page)), boxOf(player(page))]);
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    expect(Math.abs(bar.x + bar.width / 2 - (capsule.x + capsule.width / 2))).toBeLessThanOrEqual(1);
    // Just above the player (12px by design), not wherever the list happens to end
    expect(capsule.y - (bar.y + bar.height)).toBeGreaterThanOrEqual(0);
    expect(capsule.y - (bar.y + bar.height)).toBeLessThanOrEqual(16);
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.y).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(viewport.width);
    expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height);
  }).toPass({ timeout: 2000 });
}

for (const [list, trackCount] of [["a long list", 40], ["a list shorter than the screen", 3]] as const) {
  test(`floats the bulk action bar centred above the player, with ${list}`, async ({ page }) => {
    await selectTwoOf(page, trackCount);

    await expectCentredAbovePlayer(page);
  });
}

test("keeps the bar centred on the player as the sidebar collapses and the queue closes", async ({ page, isMobile }) => {
  test.skip(isMobile, "on a phone the sidebar and the queue open as sheets over the page");
  await selectTwoOf(page, 40);

  // Each change is measured once the column has moved: the player's centre shifts left as the sidebar folds to icons
  // and right as the queue panel closes
  const open = await centreOf(player(page));
  // The sidebar's own shortcut; its trigger and its edge rail share the name Toggle Sidebar
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(() => centreOf(player(page))).toBeLessThan(open - 50);
  await expectCentredAbovePlayer(page);

  const collapsed = await centreOf(player(page));
  await player(page).getByRole("button", { name: "Close queue" }).click();
  await expect.poll(() => centreOf(player(page))).toBeGreaterThan(collapsed + 50);
  await expectCentredAbovePlayer(page);
});

// Narrow screens show the count alone and some buttons as an icon alone; the words stay for screen readers
test("names the count and each of the bar's buttons", async ({ page }) => {
  await selectTwoOf(page, 40);

  await expect(bulkBar(page)).toMatchAriaSnapshot(`
    - complementary "Bulk actions":
      - text: 2 selected
      - button "Select view"
      - button "Playlist"
      - button "Delete"
      - button "Clear"
  `);
});
