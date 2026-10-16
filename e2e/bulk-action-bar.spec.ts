import { expect, test } from "@playwright/test";
import { makeTracks, mockLibrary } from "./mock-library";

// Selecting rows brings up the bulk action bar.

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
