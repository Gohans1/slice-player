import { expect, test } from "@playwright/test";
import { makeTracks, mockLibrary } from "./mock-library";

// A queued link is one line that never wraps. The YouTube dialog cuts a long one short, and its own width stays put
test("keeps a long link in the YouTube dialog from widening the dialog", async ({ page }) => {
  await mockLibrary(page, { tracks: makeTracks(3) });
  await page.route("**/api/tracks/ingest-youtube", (route) => route.fulfill({ json: { success: true, tracks: makeTracks(11) } }));
  await page.goto("/");
  await page.getByRole("button", { name: "+ YouTube" }).click();
  const dialog = page.getByRole("dialog", { name: "Add YouTube Audio" });
  await dialog.getByRole("textbox", { name: "Add YouTube Audio" }).fill("https://www.youtube.com/playlist?list=PLAmqcHYwWkJ8u8x2Fq3dT9rE5vB7nC1aZ");
  await dialog.getByRole("button", { name: "Add Tracks" }).click();
  await expect(dialog.getByText("+11 tracks")).toBeVisible();

  const { contentWidth, dialogWidth } = await dialog.evaluate((popup) => ({
    contentWidth: popup.scrollWidth,
    dialogWidth: popup.clientWidth,
  }));
  expect(contentWidth).toBeLessThanOrEqual(dialogWidth);
});
