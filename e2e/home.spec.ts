import { expect, test } from "@playwright/test";
import { makeTracks, mockLibrary } from "./mock-library";

// Home's shelves scroll sideways inside themselves; the page around them never does
test("keeps the page from scrolling sideways around Home's shelves", async ({ page }) => {
  await mockLibrary(page, { tracks: makeTracks(40) });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recently Added" })).toBeVisible();

  const { pageWidth, viewportWidth } = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(pageWidth).toBeLessThanOrEqual(viewportWidth);
});
