# Task List: Sub-Playlists (1-Level Nested Playlists)

## Phase 1: Database Schema & Backend Operations

- [x] Task 1: Migration v9 & Core Playlist Operations
  - Description: Implement migration v9 in `src/server/db.ts` adding `parent_id` column and index. Update `createPlaylist` (enforcing depth=1, non-mix parent), `getPlaylist`, `listPlaylists`, and `deletePlaylist` (handling `keepChildren` and child ID pre-fetching).
  - Acceptance:
    - `playlists` table contains `parent_id TEXT REFERENCES playlists(id) ON DELETE CASCADE` with `idx_playlists_parent_id`.
    - Cannot create a child of a child (throws error on depth > 1).
    - Cannot create a child with a mix playlist as parent.
    - `getPlaylist` and `listPlaylists` return `parent_id`.
    - `deletePlaylist(id, keepChildren)` properly promotes or cascades children.
  - Verify: `bun test src/server/subPlaylist.test.ts`
  - Dependencies: None
  - Files: `src/server/types.ts`, `src/server/db.ts`, `src/server/subPlaylist.test.ts`
  - Estimated scope: S (3 files)

- [x] Task 2: Invariant Operations (Auto-Bubble & Cascade Deletions for Single & Batch Items)
  - Description: Implement atomic auto-bubble and cascade removal in `src/server/db.ts` for both single item and batch item operations. Return affected playlist IDs for event notifications.
  - Acceptance:
    - Adding track/slice to child auto-inserts into parent if missing (`addPlaylistItem` & `addPlaylistItemsBatch`).
    - Removing track/slice from parent cascade-deletes matching items in all child playlists (`removePlaylistItem` & `removePlaylistItemsBatch`).
    - Both single and batch operations return affected playlist IDs.
    - All operations execute within atomic transactions.
  - Verify: `bun test src/server/subPlaylist.test.ts`
  - Dependencies: Task 1
  - Files: `src/server/db.ts`, `src/server/subPlaylist.test.ts`
  - Estimated scope: S (2 files)

- [x] Task 3: API Endpoints & Real-Time WebSocket Events
  - Description: Update `src/server/index.ts` routes: `POST /api/playlists` (parent_id validation), `PATCH /api/playlists/:id` (reject parent_id), `DELETE /api/playlists/:id` (keep_children and multi-playlist WS event emission). Add automated HTTP endpoint & WebSocket emission tests.
  - Acceptance:
    - `POST /api/playlists` validates parent_id and creates sub-playlist.
    - `PATCH /api/playlists/:id` returns 400 Bad Request if parent_id is passed.
    - `DELETE /api/playlists/:id` emits `playlist_deleted` for parent and children (or `playlist_updated` for promoted children).
    - Auto-bubble and cascade deletes emit `playlist_items_changed` for all affected playlist IDs.
  - Verify: `bun test src/server/subPlaylist.test.ts`
  - Dependencies: Task 1, Task 2
  - Files: `src/server/index.ts`, `src/server/subPlaylist.test.ts`
  - Estimated scope: S (2 files)

## Checkpoint 1: Backend Foundation
- [x] All tests in `src/server/subPlaylist.test.ts` pass cleanly.
- [x] All existing database and mix playlist tests pass (`bun test src/server/db.test.ts src/server/mixPlaylist.test.ts`).

## Phase 2: Client State & i18n

- [x] Task 4: Internationalization & Zustand Store Updates
  - Description: Add i18n translation keys in `en.json` and `vi.json`. Update `usePlayerStore.ts` with sub-playlist support, active state cleanup, and playback queue isolation.
  - Acceptance:
    - `createPlaylist(name, parentId)` sends `parent_id`.
    - `deletePlaylist(id, keepChildren)` cleans up store if active playlist or playing playlist was a cascade-deleted child.
    - Playback queue is strictly isolated (no cross-pollution between parent and child).
    - English and Vietnamese translation keys present for sub-playlists.
  - Verify: `bun test src/client/src/store/subPlaylist.test.ts`
  - Dependencies: Task 3
  - Files: `src/client/src/locales/en.json`, `src/client/src/locales/vi.json`, `src/client/src/store/usePlayerStore.ts`, `src/client/src/store/subPlaylist.test.ts`
  - Estimated scope: M (4 files)

## Checkpoint 2: Store Verification
- [x] `bun test src/client/src/store/subPlaylist.test.ts` passes.
- [x] Existing store tests pass (`bun test src/client/src/store/playlist.test.ts`).

## Phase 3: Hierarchical Menus & Modals

- [x] Task 5: AddToPlaylistPopover & BulkActionBar Tree Grouping
  - Description: Update `AddToPlaylistPopover.tsx`, `BulkActionBar.tsx`, and `CreatePlaylistModal.tsx` to display and manage sub-playlists hierarchically.
  - Acceptance:
    - Root playlists render with indented sub-playlists using `↳` tree connectors.
    - Viewport container uses `max-h-60` for comfortable scrolling.
    - Ticking a child playlist auto-checks parent optimistically.
    - Unticking a parent playlist immediately refreshes child membership checkboxes.
    - `CreatePlaylistModal` accepts optional `parentId` to pre-assign parent.
  - Verify: `bun run typecheck && bun test`
  - Dependencies: Task 4
  - Files: `src/client/src/components/AddToPlaylistPopover.tsx`, `src/client/src/components/BulkActionBar.tsx`, `src/client/src/components/CreatePlaylistModal.tsx`
  - Estimated scope: M (3 files)

- [x] Task 6: PlaylistHeader Navigation Bar, Shared DeletePlaylistModal & Badges
  - Description: Create shared `DeletePlaylistModal.tsx`. Update `PlaylistHeader.tsx` to render sub-playlists bar for root playlists and breadcrumbs for child playlists. Update `PlaylistGrid.tsx` and `PlaylistDrawer.tsx` to show sub-playlist badges and use `DeletePlaylistModal`.
  - Acceptance:
    - Root playlist displays sub-playlists pill tabs with item count and "+ New Sub-Playlist" button.
    - Child playlist displays breadcrumb link back to parent (`← Parent / Child`).
    - Deleting a parent playlist with children displays `DeletePlaylistModal` with choice to cascade-delete or keep children.
    - `PlaylistGrid` and `PlaylistDrawer` display sub-playlist badge with `FolderTree` icon and accessible screen reader text.
  - Verify: `bun run typecheck && bun test`
  - Dependencies: Task 5
  - Files: `src/client/src/components/DeletePlaylistModal.tsx`, `src/client/src/components/PlaylistHeader.tsx`, `src/client/src/components/PlaylistGrid.tsx`, `src/client/src/components/PlaylistDrawer.tsx`
  - Estimated scope: M (4 files)

## Checkpoint 3: UI & Build Verification
- [x] `bun run typecheck` passes with zero errors.
- [x] `bun run lint` passes.
- [x] `bun test` passes across the entire project (except external ffmpeg missing for audioExtractor test).

## Phase 4: Live Browser Verification

- [x] Task 7: End-to-End Live Browser Testing via `agent-browser`
  - Description: Verify complete user workflows in real Chromium browser via `agent-browser` on `http://127.0.0.1:3000`.
  - Acceptance:
    - Create parent playlist and add tracks.
    - Create child playlist from sub-playlists bar.
    - Add tracks to child playlist and confirm auto-bubble in parent.
    - Remove track from parent and confirm cascade removal from child.
    - Delete parent playlist with "Keep sub-playlists" option and confirm child becomes root.
    - Screenshots captured and stored as proof.
  - Verify: `agent-browser screenshot` and DOM verification
  - Dependencies: Task 6
  - Files: Browser testing / Verification
  - Estimated scope: S
