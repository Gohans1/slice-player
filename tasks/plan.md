# Implementation Plan: Sub-Playlists (1-Level Nested Playlists)

## Overview
Implement 1-level nested sub-playlists across Slice Player. A sub-playlist allows users to curate a subset of songs within a parent playlist. The system guarantees the core invariant $\text{Items}(\text{Child}) \subseteq \text{Items}(\text{Parent})$ via atomic database-level auto-bubble on insertion and cascade removal on deletion, with full real-time WebSocket synchronization across tabs and an accessible, refined Flexoki UI.

## Architecture Decisions
1. **Schema Migration v9**: Add `parent_id TEXT REFERENCES playlists(id) ON DELETE CASCADE` with `CREATE INDEX idx_playlists_parent_id ON playlists(parent_id)`.
2. **Strict 1-Level Depth**: Enforced at server & DB level (`parent.parent_id IS NULL`, non-mix, rejecting depth > 1).
3. **Immutable Reparenting**: Modifying `parent_id` via PATCH is rejected with 400 Bad Request to prevent invariant violations.
4. **Atomic Auto-Bubble & Affected IDs Notification**: Adding tracks to child (single `addPlaylistItem` or batch `addPlaylistItemsBatch`) automatically checks and inserts missing items into the parent playlist within the same transaction. DB operations return or expose all affected playlist IDs so `index.ts` broadcasts `playlist_items_changed` for all affected playlists.
5. **Atomic Cascade Removal**: Removing tracks from parent (`removePlaylistItem` or `removePlaylistItemsBatch`) automatically deletes matching items from all child playlists within the same transaction and emits `playlist_items_changed` for all affected playlists.
6. **Parent Deletion Retention Option**: When deleting a parent playlist with children, users can choose:
   - Cascade delete (deletes parent and all child playlists).
   - Promote to root (updates children `parent_id = NULL`, deletes parent).
   Server pre-queries child IDs to emit accurate `playlist_deleted` or `playlist_updated` WebSocket events.
7. **Playback Queue Isolation**: Playback queues are strictly isolated between parent and child playlists (no cross-pollution in `usePlayerStore`).
8. **UI/UX Craft & Modularity**:
   - `AddToPlaylistPopover` & `BulkActionBar`: Grouped tree layout with `↳` connectors and `max-h-60` container.
   - `PlaylistHeader`: Sub-playlist navigation bar for root playlists, breadcrumb link for child playlists.
   - `PlaylistGrid` & `PlaylistDrawer`: `FolderTree` badge for child playlists with screen reader announcement.
   - `DeletePlaylistModal.tsx`: Shared, dedicated modal component used by both `PlaylistHeader` and `PlaylistDrawer` for retention choices.

## Task Breakdown

### Phase 1: Database Schema & Backend Operations
- **Task 1: Migration v9 & Core Playlist Operations**
  - Implement migration v9 in `src/server/db.ts`.
  - Update `createPlaylist` (validation for depth=1, non-mix parent), `getPlaylist`, and `listPlaylists` (include `parent_id`).
  - Update `deletePlaylist` with `keepChildren` parameter and child ID pre-fetching.
  - Verify with `src/server/subPlaylist.test.ts`.
- **Task 2: Invariant Operations (Auto-Bubble & Cascade Deletions for Single & Batch Items)**
  - Implement single and batch auto-bubble in `addPlaylistItem` and `addPlaylistItemsBatch`.
  - Implement cascade removals in `removePlaylistItem` and `removePlaylistItemsBatch`.
  - Expose affected playlist IDs for WebSocket broadcast.
  - Add comprehensive unit tests in `src/server/subPlaylist.test.ts` covering batch and slice/segment scenarios.
- **Task 3: API Routes & WebSocket Event Broadcasts**
  - Update `POST /api/playlists` in `src/server/index.ts` to sanitize and handle `parent_id`.
  - Update `PATCH /api/playlists/:id` to reject `parent_id` with 400.
  - Update `DELETE /api/playlists/:id` to support `keep_children` and emit multi-playlist WebSocket events (`playlist_deleted`, `playlist_updated`, `playlist_items_changed`).
  - Add integration tests in `src/server/subPlaylist.test.ts` for HTTP routes and WebSocket broadcasts.

### Checkpoint 1: Backend Verification
- [ ] All `src/server/subPlaylist.test.ts` tests pass.
- [ ] All existing database and mix playlist tests pass (`bun test src/server/db.test.ts src/server/mixPlaylist.test.ts`).

### Phase 2: Client State & i18n
- **Task 4: Internationalization & Zustand Store Updates**
  - Add English and Vietnamese keys for sub-playlists in `src/client/src/locales/en.json` and `vi.json`.
  - Update `usePlayerStore.ts`: `createPlaylist(name, parentId)`, `deletePlaylist(id, keepChildren)` with child playlist cleanup and queue isolation.
  - Write and verify `src/client/src/store/subPlaylist.test.ts`.

### Checkpoint 2: Store Verification
- [ ] `bun test src/client/src/store/subPlaylist.test.ts` passes.
- [ ] All existing store tests pass (`bun test src/client/src/store/playlist.test.ts`).

### Phase 3: Hierarchical Menus & Modals
- **Task 5: AddToPlaylistPopover & BulkActionBar Hierarchical Layout**
  - Update `AddToPlaylistPopover.tsx` with tree grouping, `↳` connectors, `max-h-60` scroll, optimistic parent check, and membership refetch on parent toggle.
  - Update `BulkActionBar.tsx` with matching tree grouping.
  - Update `CreatePlaylistModal.tsx` to accept optional `parentId` prop.
- **Task 6: PlaylistHeader Navigation Bar, Shared DeletePlaylistModal & Badges**
  - Create shared `DeletePlaylistModal.tsx` component.
  - Update `PlaylistHeader.tsx` to render sub-playlists bar for root playlists and breadcrumb for child playlists.
  - Update `PlaylistGrid.tsx` and `PlaylistDrawer.tsx` to show sub-playlist badges and use `DeletePlaylistModal`.

### Checkpoint 3: UI & Build Verification
- [ ] `bun run typecheck` passes with zero errors.
- [ ] `bun run lint` passes.
- [ ] `bun test` passes across the entire project.

### Phase 4: Live Browser Verification
- **Task 7: End-to-End Browser Testing via `agent-browser`**
  - Launch dev server at `http://127.0.0.1:3000`.
  - Open browser, create parent playlist, add tracks.
  - Create sub-playlist, verify it appears in sub-playlists bar and library view with badge.
  - Add tracks to sub-playlist and verify auto-bubble in parent playlist.
  - Delete track from parent and verify cascaded removal in sub-playlist.
  - Test parent playlist deletion with "Keep sub-playlists" option and verify promotion to root.
  - Capture screenshots for verification evidence.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Concurrent multi-tab deletion of parent playlist | Medium | Pre-query child IDs before DELETE and broadcast individual WebSocket events for each affected playlist |
| Deep nesting recursion | High | Hard rejection at API & DB layer if `parent.parent_id != null` |
| Queue desync during playback | High | Strict queue isolation: adding to child/parent only queues into the exact playing playlist |
