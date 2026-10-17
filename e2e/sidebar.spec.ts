import { expect, test } from "@playwright/test";
import { makeTracks, mockLibrary } from "./mock-library";

// Below the wide layout (1280px) the sidebar folds to icons. Each group's label then fades out and slides up into the
// group above it, over the last button there: Library over Home, Playlists over Errors. Those buttons still take a
// click anywhere on them.
test.use({ viewport: { width: 1024, height: 768 } });

test("takes clicks on the buttons that the icon sidebar's hidden group labels slide over", async ({ page, isMobile }) => {
  test.skip(isMobile, "on a phone the sidebar is a sheet and never folds to icons");
  await mockLibrary(page, { tracks: makeTracks(3) });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recently Added" })).toBeVisible();

  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Errors", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recently Added" })).toBeVisible();
});
