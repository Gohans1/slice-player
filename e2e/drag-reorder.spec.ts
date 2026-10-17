import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Playlist, PlaylistItemWithDetails } from "../src/server/types";
import { makeTracks, mockLibrary } from "./mock-library";

// A playlist's rows and the queue's reorder by drag. While a row is dragged, the rows between its place and the pointer
// slide aside and its faded copy slides into the gap they open, where a drop puts it. happy-dom lays nothing out, so
// only a browser can tell where the rows sit, and which one the pointer is over, as they move.

type Box = { x: number; y: number; width: number; height: number };

test.skip(({ isMobile }) => isMobile, "touch screens reorder with the rows' Move up / Move down buttons, not by drag");

const tracks = makeTracks(5);
const playlist: Playlist = {
  id: "pl_road",
  name: "Road Trip",
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  item_count: tracks.length,
  is_custom_ordered: true,
};
const playlistItems: PlaylistItemWithDetails[] = tracks.map((track, i) => ({
  id: `item_${i + 1}`,
  playlist_id: playlist.id,
  track_id: track.id,
  segment_id: null,
  sort_order: i,
  added_at: 1_700_000_000_000 + i,
  track,
}));

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not laid out");
  return box;
}

const boxesOf = async (rows: Locator) => Promise.all((await rows.all()).map(boxOf));

// Picks up the first row by its grip and moves the pointer in small steps, as a hand would, so the browser runs a real
// drag and hit-tests each step: down to the fourth row's place, then back up to the third, over the rows that slid
async function dragFirstRowToThird(page: Page, rows: Locator) {
  const slots = await boxesOf(rows);
  const first = rows.first();
  await first.hover();
  const grip = await boxOf(first.getByRole("button", { name: /^Reorder / }));
  const x = grip.x + grip.width / 2;
  await page.mouse.move(x, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, slots[3].y + slots[3].height / 2, { steps: 12 });
  await page.mouse.move(x, slots[2].y + slots[2].height / 2, { steps: 6 });
  return slots;
}

// Read once the rows have finished sliding: none covers another, and the dragged row's faded copy sits in the slot
// under the pointer
async function expectGapUnderPointer(rows: Locator, draggedName: string, slot: Box) {
  await expect(async () => {
    const boxes = (await boxesOf(rows)).toSorted((a, b) => a.y - b.y);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
    const dragged = await boxOf(rows.filter({ hasText: draggedName }));
    expect(Math.abs(dragged.y - slot.y)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 2000 });
}

test("drops a playlist row in the gap the other rows open for it", async ({ page }) => {
  await mockLibrary(page, { tracks, playlists: [playlist], playlistItems });
  await page.route(`**/api/playlists/${playlist.id}/reorder`, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await page.getByText(playlist.name).first().click();
  const rows = page.getByRole("table", { name: "Playlists" }).getByRole("rowgroup").getByRole("row");
  await expect(rows).toHaveCount(5);

  const slots = await dragFirstRowToThird(page, rows);
  await expectGapUnderPointer(rows, "Track 001", slots[2]);

  const reorder = page.waitForRequest(`**/api/playlists/${playlist.id}/reorder`);
  await page.mouse.up();
  expect((await reorder).postDataJSON()).toEqual({ itemIds: ["item_2", "item_3", "item_1", "item_4", "item_5"] });
});
