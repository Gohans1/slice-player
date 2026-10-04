# Spec: Sub-Playlists (1-Level Nested Playlists)

## 1. Objective
Deliver a first-class "Sub-Playlists" (Nested Playlists) capability to Slice Player:
- Users can organize tracks/slices within a playlist into dedicated sub-playlists (crates/sub-groups).
- **Core Invariant**: Every item in a sub-playlist MUST belong to its parent playlist: $\text{Items}(\text{Child}) \subseteq \text{Items}(\text{Parent})$.
- **Nesting Limit**: Strict 1-level hierarchy ($\text{Root} \rightarrow \text{Child}$). A child cannot have further children.
- **Smart Auto-Bubble**: Adding an item (singly or in batch) to a child playlist from any surface automatically adds the item to the parent playlist if it is not already present.
- **Cascade Deletion**: Removing an item from a parent playlist automatically removes it from all its child playlists.
- **Parent Playlist Deletion**: When deleting a parent playlist with children, the user chooses whether to cascade-delete all sub-playlists or promote them to root playlists (`parent_id = NULL`).
- **UI/UX Craft**: Seamless integration with the existing Flexoki design system, providing sub-playlist navigation tabs inside parent playlists, parent badges on child playlists in library views, and hierarchical grouping in the "Add to Playlist" popover and Bulk Action Bar.

## 2. Tech Stack & Dependencies
- Runtime & Package Manager: Bun (v1.4.2+)
- Backend & DB: Bun native HTTP server (`Bun.serve`), SQLite (`bun:sqlite`)
- Frontend Framework: React 19, TypeScript 5.8+
- State Management: Zustand v5
- Styling: Tailwind CSS v4, Lucide React icons
- Virtualization: `@tanstack/react-virtual`
- Internationalization: `react-i18next` (English & Vietnamese)
- Testing: `bun test` with Happy-DOM

## 3. Commands
- Dev Server: `bun run dev` (starts backend at `http://127.0.0.1:3000` and serves client)
- Test Suite: `bun test`
- Focused Tests: `bun test src/server/subPlaylist.test.ts src/client/src/store/subPlaylist.test.ts`
- Linting: `bun run lint`
- Type Check: `bun run typecheck`
- Production Build: `bun run build`

## 4. Project Structure & Impact Map
```
src/
├── server/
│   ├── types.ts                   → Add parent_id?: string | null to Playlist interface
│   ├── db.ts                      → Migration v9 (PRAGMA user_version = 9), CRUD methods, cascade & auto-bubble logic (single + batch)
│   ├── index.ts                   → API endpoints: POST /api/playlists (parent_id), DELETE /api/playlists/:id (keep_children), WS event emissions
│   └── subPlaylist.test.ts        → Backend unit/integration tests for sub-playlists
└── client/src/
    ├── locales/
    │   ├── en.json                → English translations for sub-playlist UI strings
    │   └── vi.json                → Vietnamese translations for sub-playlist UI strings
    ├── store/
    │   ├── usePlayerStore.ts      → Update createPlaylist(name, parentId), deletePlaylist(id, keepChildren) with child state cleanup and playback queue isolation
    │   └── subPlaylist.test.ts    → Client store tests for sub-playlists
    ├── components/
    │   ├── CreatePlaylistModal.tsx→ Add optional parentId prop or selection
    │   ├── AddToPlaylistPopover.tsx→ Hierarchical indentation/grouping for parent & child playlists, membership refresh on toggle
    │   ├── BulkActionBar.tsx      → Hierarchical indentation/grouping for multi-track playlist menu
    │   ├── PlaylistHeader.tsx     → Sub-playlist navigation bar (root only), parent breadcrumb (child only), delete modal options
    │   ├── PlaylistGrid.tsx       → Render badge [Parent Name] with FolderTree icon on child playlist cards
    │   └── PlaylistDrawer.tsx     → Render sub-playlists indented with badge; retention modal on delete
```

## 5. Architecture & Data Integrity Invariants

### 5.1. Database Schema (Migration v9)
- Table `playlists`:
  - Add column: `parent_id TEXT REFERENCES playlists(id) ON DELETE CASCADE`
  - Index: `idx_playlists_parent_id ON playlists(parent_id)`
  - PRAGMA user_version = 9
- Invariants enforced by database & logic:
  1. A mix playlist cannot have a `parent_id` and cannot be a parent (`is_mix = 1` forbids nesting).
  2. A child playlist (`parent_id IS NOT NULL`) cannot itself be a parent (1-level maximum depth).
  3. `parent_id` must point to an existing non-mix playlist.
  4. Reparenting via `PATCH /api/playlists/:id` is strictly forbidden (immutable root or child status).

### 5.2. Item Operations & Auto-Bubble Invariant
- **Single Item Insertion (`addPlaylistItem`)**:
  - If `playlist.parent_id` exists:
    - Check if item `(trackId, segmentId)` is present in `parent_id`.
    - If absent, auto-insert into parent playlist first.
  - Insert item into child playlist.
- **Batch Item Insertion (`addPlaylistItemsBatch`)**:
  - If `playlist.parent_id` exists:
    - Identify all unique `(trackId, segmentId)` pairs missing from the parent playlist.
    - Within the transaction, batch-insert missing items into the parent playlist first.
    - Insert all items into the child playlist.
- **Cascade Removal (`removePlaylistItem` & `removePlaylistItemsBatch`)**:
  - If playlist has child playlists (`SELECT id FROM playlists WHERE parent_id = playlistId`):
    - Identify `track_id` and `segment_id` of removed item(s).
    - Cascade delete matching items in all child playlists within the same transaction.

### 5.3. Deletion Strategy & Store Cleanup
- `deletePlaylist(playlistId, keepChildren = false)`:
  - Pre-query child playlist IDs: `SELECT id FROM playlists WHERE parent_id = playlistId;`
  - If `keepChildren === true`:
    - `UPDATE playlists SET parent_id = NULL WHERE parent_id = playlistId;`
    - Delete parent playlist `playlistId`.
  - If `keepChildren === false`:
    - Delete parent playlist `playlistId` (SQLite cascades delete to all child playlists).
- **Store Active State Cleanup**:
  - When `deletePlaylist(playlistId, keepChildren)` is invoked on client, if `keepChildren === false`, the store cleans up `activePlaylistId` and `activePlaylistPlayingId` if they match either `playlistId` or any of its child playlist IDs.

## 6. API Contracts, Real-Time Events & Queue Isolation

### 6.1. `POST /api/playlists`
- Request body:
  ```json
  {
    "name": "Sub-playlist Name",
    "parent_id": "pl_123" // optional string | null, sanitized (empty string -> null)
  }
  ```
- Validation:
  - 400 if `parent_id` points to a non-existent playlist.
  - 400 if `parent_id` points to a playlist that already has a `parent_id` (depth > 1).
  - 400 if `parent_id` points to a mix playlist.
- Response: 201 Created with Playlist JSON object including `parent_id`.

### 6.2. `PATCH /api/playlists/:id`
- Request body: `{ "name": "New Name", "cover_track_id": "..." }`
- Validation: 400 Bad Request if `parent_id` is passed in body (reparenting is disallowed).

### 6.3. `DELETE /api/playlists/:id`
- Query parameter: `?keep_children=true|false` (default: `false`)
- WebSocket Event Broadcasts (pre-queried child IDs):
  - If `keep_children=false`: Server broadcasts `playlist_deleted` for `playlistId` AND for each cascade-deleted child playlist ID.
  - If `keep_children=true`: Server broadcasts `playlist_deleted` for `playlistId` AND `playlist_updated` for each promoted child playlist.
- Response: 200 `{ "success": true }`.

### 6.4. Item Changes, Queue Isolation & View Reactivity
- **Server WebSocket Broadcasts**:
  - When items are auto-bubbled to parent or cascade-deleted from children, the server emits `playlist_items_changed` for all affected playlist IDs (parent and children).
- **Playback Queue Isolation**:
  - `showsItemsOf` remains scoped to Mix playlists (`viewId === changedId || isMixSource(viewId, changedId)`). It is **NOT** overloaded for parent-child sub-playlists to prevent queue contamination when playing a child or parent.
  - In `usePlayerStore.addToPlaylist`, queue optimistic appending only occurs if `activePlaylistPlayingId === playlistId` (exact playlist match) or when `activePlaylistPlayingId` is a mix sourcing `playlistId`.
- **Active View Reactivity**:
  - When the server broadcasts `playlist_items_changed` for any playlist ID, `App.tsx`'s listener checks if `event.playlistId === activePlaylistId`. Because the server broadcasts the event for both parent and child on auto-bubble / cascade, the active view refreshes automatically and cleanly without polluting playback queues.

## 7. Frontend UI Engineering & Design System (Impeccable Craft)

### 7.1. AddToPlaylistPopover & BulkActionBar
- Visually groups root playlists and their respective child playlists.
- Children are indented with a tree-line connector `↳` and subtle badge.
- Viewport scroll container comfortable height: `max-h-60` (240px).
- Keyboard navigation (Arrow keys, Space to toggle) fully preserved.
- When toggling a child playlist, if parent was unchecked, UI optimistically checks the parent (due to auto-bubble).
- When toggling a parent playlist off, popover refetches/updates child memberships immediately so child checkboxes do not remain stale.

### 7.2. PlaylistHeader & Sub-Playlists Bar
- **When viewing a Root Playlist (`!playlist.parent_id && !playlist.is_mix`)**:
  - Display Sub-Playlists Bar directly under the header controls.
  - Styled with horizontal pill buttons (Flexoki design tokens: `bg-secondary/60 hover:bg-secondary text-xs rounded-full`).
  - Includes item count badge on each child pill.
  - Includes a "+ New Sub-Playlist" button triggering `CreatePlaylistModal` with `parentId` preset.
- **When viewing a Child Playlist (`playlist.parent_id != null`)**:
  - Hide the Sub-Playlists Bar (enforces 1-level hierarchy).
  - Display a breadcrumb link back to parent: `← [Parent Playlist Name] / [Child Name]`.
  - Clicking parent returns to parent playlist view.

### 7.3. Main Library View (`PlaylistGrid.tsx`) & `PlaylistDrawer.tsx`
- `PlaylistGrid` shows all playlists.
- Child playlists show a distinct, subtle badge in header/meta with Lucide `FolderTree` icon: `[ParentName]`.
- Screen readers announce "Sub-playlist of ParentName".
- `PlaylistDrawer.tsx` renders sub-playlists indented under parent playlists and opens retention confirmation modal on delete.

### 7.4. Delete Confirmation Modal
- If a playlist has 1 or more child playlists:
  - Modal title: "Delete Playlist [Name]"
  - Warning alert showing how many sub-playlists are attached.
  - Radio options or checkbox:
    - `[x] Also delete X sub-playlists`
    - `[ ] Keep sub-playlists as standalone playlists`
  - Defaults to safe, explicit selection.

## 8. Testing Strategy
- **Backend Tests (`src/server/subPlaylist.test.ts`)**:
  - Test migration v9 creates `parent_id` column and index.
  - Test creation with valid and invalid `parent_id`.
  - Test rejection of nesting depth > 1.
  - Test auto-bubble for single item (`addPlaylistItem`) and batch items (`addPlaylistItemsBatch`).
  - Test cascade removal when removing track from parent (`removePlaylistItem` & `removePlaylistItemsBatch`).
  - Test cascade delete vs promote on parent deletion with pre-queried child IDs.
  - Test rejection of `parent_id` in `PATCH /api/playlists/:id`.
  - Test WebSocket events emission on cascade and promotion.
- **Store Tests (`src/client/src/store/subPlaylist.test.ts`)**:
  - Test store action `createPlaylist(name, parentId)`.
  - Test store action `deletePlaylist(id, keepChildren)` and child state cleanup.
  - Test playback queue isolation when adding to parent/child.
- **Component Tests**:
  - Test `AddToPlaylistPopover` renders hierarchy and triggers correct store actions.
  - Test `PlaylistHeader` renders sub-playlist bar when children exist.
  - Test `DeletePlaylistModal` displays sub-playlist retention choices.
- **Live Browser Verification (`agent-browser`)**:
  - Launch app on `http://127.0.0.1:3000`.
  - Verify complete workflow in browser: Create parent playlist, add tracks, create sub-playlist, add track to sub-playlist, verify parent contains track, delete track from parent, verify sub-playlist update, delete parent with retention choice.

## 9. Boundaries
- **Always**:
  - Maintain data invariant: child items $\subseteq$ parent items (both single and batch).
  - Enforce strict 1-level hierarchy.
  - Disallow reparenting via PATCH.
  - Isolate playback queues between parent and child playlists.
  - Test with `bun test` before merging increments.
  - Verify visually in browser using `agent-browser`.
- **Ask First**:
  - Changing database migration versions beyond v9.
  - Modifying core playback queue synchronization algorithms.
- **Never**:
  - Allow circular parent-child relationships.
  - Allow mix playlists to act as parents or children.
  - Hardcode raw hex colors instead of Tailwind/Flexoki tokens.
  - Create orphaned items in child playlists when parent items are deleted.

## 10. Success Criteria
- [ ] Database migration v9 runs cleanly on fresh and existing databases.
- [ ] Sub-playlists cannot be nested deeper than 1 level.
- [ ] Auto-bubble and cascade deletion logic (single and batch) are 100% verified with automated tests.
- [ ] WebSocket events synchronize multi-tab state for cascades and promotions.
- [ ] Playback queues remain strictly isolated between parent and child playlists.
- [ ] UI components render hierarchical playlist relationships cleanly with zero regressions.
- [ ] All existing tests continue to pass.
- [ ] End-to-end user experience verified in real browser via `agent-browser` with screenshots.
