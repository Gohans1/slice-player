import { expect, test, type Locator } from "@playwright/test";
import { makeTracks, mockLibrary } from "./mock-library";

// Selecting rows brings up the bulk action bar. It floats just above the player capsule and centred on it, wherever
// the main column sits between the sidebar and the queue panel.

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not laid out");
  return box;
}

test.beforeEach(async ({ page }) => {
  await mockLibrary(page, { tracks: makeTracks(40) });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "More options for Track 001", exact: true })).toBeVisible();

  // The way in that phones have too: Select in a row's "..." menu, then tapping rows adds them
  await page.getByRole("button", { name: "More options for Track 001", exact: true }).click();
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await page.getByRole("row", { name: "Select Track 002", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Bulk actions" })).toContainText("2");
});

test("floats the bulk action bar centred above the player", async ({ page }) => {
  const bar = page.getByRole("complementary", { name: "Bulk actions" });
  const capsule = page.getByRole("region", { name: "Player" });

  // Read once the bar has finished sliding in
  await expect(async () => {
    const [barBox, capsuleBox] = await Promise.all([boxOf(bar), boxOf(capsule)]);
    const viewport = page.viewportSize();
    expect(Math.abs(barBox.x + barBox.width / 2 - (capsuleBox.x + capsuleBox.width / 2))).toBeLessThanOrEqual(1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(capsuleBox.y);
    expect(barBox.x).toBeGreaterThanOrEqual(0);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewport?.width ?? 0);
  }).toPass({ timeout: 2000 });
});

// Narrow screens show the count alone and some buttons as an icon alone; the words stay for screen readers
test("names the count and each of the bar's buttons", async ({ page }) => {
  await expect(page.getByRole("complementary", { name: "Bulk actions" })).toMatchAriaSnapshot(`
    - complementary "Bulk actions":
      - text: 2 selected
      - button "Select view"
      - button "Playlist"
      - button "Delete"
      - button "Clear"
  `);
});
