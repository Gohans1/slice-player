# Task Checklist: Direction 1 — Pure-Rust Engine (`crates/engine`) + Desktop Shell Migration

Plan details: [plan.md](file:///home/gohans-linux/projects/slice-player/tasks/plan.md)

## Phase 1: Cargo Workspace, SQLite `./data/music.db` Parity & Core HTTP/CRUD Server

- [x] **Task 1 (`task-1`): Initialize Cargo Workspace & `crates/engine` Skeleton**
  - **Description**: Create root `Cargo.toml` (`members = ["crates/engine"]`, `default-members = ["crates/engine"]`, `exclude = ["src-tauri"]`) and `crates/engine` (`slice-engine` lib + `slice-server` bin) with `EngineConfig` and `appWindow` single-instance/window-launcher/idle-shutdown helpers (`appWindow.test.ts` parity).
  - **Acceptance criteria**:
    - [x] `crates/engine` compiles with zero warnings and exports `EngineConfig` + `appWindow` lifecycle helpers (`find_app_browser`, `is_server_running`, `open_app_window`, 180s startup watchdog, 60s WebSocket idle shutdown, and safe `<exe_dir>/dist` chdir check).
    - [x] `.gitignore` excludes `/target`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`
    - [x] Build succeeds: `PATH="$HOME/.cargo/bin:$PATH" cargo check -p slice-engine`
  - **Dependencies**: None
  - **Files likely touched**: `Cargo.toml`, `crates/engine/Cargo.toml`, `crates/engine/src/lib.rs`, `crates/engine/src/bin/slice-server.rs`, `.gitignore`
  - **Estimated scope**: `S`

- [x] **Task 2 (`task-2`): Port SQLite `./data/music.db` Schema (`v1..v11`), Pragmas, Startup Cleanup & Recovery**
  - **Description**: Port SQLite initialization, WAL pragmas, migrations `v1..v11`, startup orphan cleanup (`heal_track_file_paths`, `.part`/`.ytdl`/audio/thumb sweep), and `recover_incomplete_ingests()` from `src/server/db.ts` and `src/server/ingest.ts`, plus tests from `db.test.ts` and `portablePaths.test.ts`.
  - **Acceptance criteria**:
    - [x] Refuses to open `./data/music.db` when `is_test == true` or `NODE_ENV == "test"`.
    - [x] Configures `busy_timeout = 5000`, `WAL`, `foreign_keys = ON`, `SQLITE_FCNTL_PERSIST_WAL = 0`, and `wal_checkpoint(TRUNCATE)` on close.
    - [x] Runs all 11 migrations (`PRAGMA user_version = 1..11`) idempotently, creating all 6 tables (`tracks`, `segments`, `playlists`, `playlist_items`, `playlist_sources`, `plays`) and 15 indexes.
    - [x] `recover_incomplete_ingests()` updates `status IN ('queued', 'downloading')` rows to `status = 'error'` with `"Tải bài hát bị gián đoạn do máy chủ khởi động lại. Vui lòng bấm Thử lại (Retry)."` (never deleting user rows) and purges partial files.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test db_test`
  - **Dependencies**: `task-1`
  - **Files likely touched**: `crates/engine/src/db/mod.rs`, `crates/engine/src/db/migrations.rs`, `crates/engine/src/db/maintenance.rs`, `crates/engine/src/models.rs`, `crates/engine/tests/db_test.rs`
  - **Estimated scope**: `M`

- [ ] **Task 3a (`task-3a`): Security Middleware, `/ws` Hub, Logs, Weak ETag & Tracks/Segments CRUD Routes**
  - **Description**: Port security middleware (`Host`, `Origin`, `Sec-Fetch-Site`, payload caps, `libraryRequests` mutation tracking), `/ws` WebSocket hub (`websocketEvents.ts`), `/api/logs` (`logger.ts`), weak ETag helper (`etag.ts`), static `./dist` serving, and Tracks/Segments CRUD routes. Port tests from `etag.test.ts`, `logger.test.ts`, `websocketEvents.test.ts`, and `security.test.ts`.
  - **Acceptance criteria**:
    - [ ] Enforces `Host`, `Origin`, `Sec-Fetch-Site: cross-site`, `Transfer-Encoding: chunked` (`400`), `Content-Length` (`411`/`413`), and `503 Retry-After: 5` during restore (`pause_library_mutations` / `drain_library_mutations`).
    - [ ] `/ws` sends `{"type":"connected"}`, replies `"pong"` to `"ping"`, and broadcasts all 14 `websocketEvents.ts` event types.
    - [ ] Implements `GET /api/logs`, `DELETE /api/logs` (with `sanitize_internal_paths`), `GET /api/tracks` (weak ETag `304`, omits `peaks_json`, attaches `download_index`), `GET /api/tracks/:id` (with `peaks_json`), `PUT/PATCH /api/tracks/:id` (resets `loudness`/`true_peak` when `file_path` changes unless explicitly supplied in the same update payload), `DELETE /api/tracks/:id`, `POST /api/tracks/batch-delete`, `GET /api/tracks/:id/segments`, `POST /api/tracks/:id/segments`, `PUT /api/segments/:id`, `DELETE /api/segments/:id`, `POST /api/segments/batch-delete`, and `GET /api/segments` (weak ETag `304`).
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine http::`
  - **Dependencies**: `task-2`
  - **Files likely touched**: `crates/engine/src/http/mod.rs`, `crates/engine/src/http/security.rs`, `crates/engine/src/http/ws_and_logs.rs`, `crates/engine/src/http/routes_tracks_segments.rs`, `crates/engine/src/db/tracks_segments.rs`
  - **Estimated scope**: `M`

- [ ] **Task 3b (`task-3b`): Playlists, Mix Playlists, 1-Level Sub-Playlists, Plays & Home Summary Routes**
  - **Description**: Port playlist CRUD, 1-level sub-playlists (`parent_id` auto-bubbling & cascade removal), live mix playlists (`is_mix`, `playlist_sources`), play history (`POST /api/plays`), and Home shelves (`GET /api/home`). Port tests from `mixPlaylist.test.ts`, `subPlaylist.test.ts`, and `plays.test.ts`.
  - **Acceptance criteria**:
    - [ ] Implements `GET /api/playlist-memberships`, `GET /api/playlists`, `POST /api/playlists`, `POST /api/playlists/mix`, `PUT /api/playlists/:id/sources`, `PUT /api/playlists/:id/reorder`, `GET /api/playlists/:id`, `PATCH /api/playlists/:id`, `DELETE /api/playlists/:id` (`keep_children` support), `POST /api/playlists/:id/items`, `POST /api/playlists/:id/items/batch`, `DELETE /api/playlists/:id/items/:itemId`, and `POST /api/playlists/:id/items/batch-delete`.
    - [ ] Adding items to a sub-playlist auto-bubbles `(track_id, segment_id)` to `parent_id`; removing items from a parent playlist cascades deletion to all child sub-playlists.
    - [ ] Implements `POST /api/plays` (`204 No Content`) and `GET /api/home` (`recently_played`, `heavy_rotation`, `top_playlists`).
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test playlists_and_plays_test`
  - **Dependencies**: `task-3a`
  - **Files likely touched**: `crates/engine/src/db/playlists.rs`, `crates/engine/src/db/plays.rs`, `crates/engine/src/http/routes_playlists.rs`, `crates/engine/src/http/routes_plays.rs`, `crates/engine/tests/playlists_and_plays_test.rs`
  - **Estimated scope**: `M`

- [ ] **Checkpoint 1**: Verify Phase 1 SQLite, Security, WebSocket, Tracks, Segments, Playlists, Mix/Sub-Playlists & Plays Parity
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`

---

## Phase 2: Pure-Rust Single-Pass Audio Analyzer, Range Streaming & Thumbnails

- [ ] **Task 4 (`task-4`): Single-Pass Streaming Audio Analyzer (`symphonia` + `libopus` + `ebur128`) & Loudness Worker**
  - **Description**: Replace `src/server/waveform.ts` and `src/server/loudness.ts` with a single-pass `O(1)` streaming decoder (`symphonia` + `symphonia-adapter-libopus` + `ebur128` + `ffmpeg` fallback) and background `measure_missing_loudness` worker. Port tests from `loudness.test.ts`.
  - **Acceptance criteria**:
    - [ ] Registers `symphonia_adapter_libopus::OpusDecoder` so `.opus`/`.webm` (`format 251`) and all standard formats decode in-process.
    - [ ] Sets `Channel::DualMono` for 1-channel audio, converts linear true peak via `20.0 * max_linear.log10()`, returns `None` on non-finite silence, and computes `1,000` peaks (`[0.0, 1.0]`, 3 decimals, `1800s` cap) with `ffmpeg` CLI and `[0.1; 1000]` fallbacks.
    - [ ] Background `measure_missing_loudness()` measures `status = 'ready' AND loudness IS NULL` newest first, announces `track_updated` (`reason: "loudness"`), and pauses cleanly via `pause_measuring_loudness()`.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test loudness_and_waveform_test`
  - **Dependencies**: `task-2`, `task-3a`
  - **Files likely touched**: `crates/engine/src/audio_analysis/mod.rs`, `crates/engine/src/audio_analysis/decoder.rs`, `crates/engine/src/audio_analysis/loudness_worker.rs`, `crates/engine/tests/loudness_and_waveform_test.rs`
  - **Estimated scope**: `M`

- [ ] **Task 5 (`task-5`): Read-Only Fallback Audio Source & HTTP Byte-Range Streaming (`/api/tracks/:id/stream`)**
  - **Description**: Port `resolveAudioSource` (`src/server/audioSource.ts`) and `GET/HEAD /api/tracks/:id/stream` (`200`, `206`, `416`, `403`, `404`). Port tests from `audioSource.test.ts`.
  - **Acceptance criteria**:
    - [ ] `resolve_audio_source` validates `validate_safe_local_audio_path` (`403`) and falls back to `./data/cache/audio/<basename>` **read-only without mutating SQLite**.
    - [ ] Serves `.opus` as `audio/ogg` and handles `HEAD` and `GET` byte-range requests (`206 Partial Content` and `416 Range Not Satisfiable`).
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test audio_source_and_stream_test`
  - **Dependencies**: `task-3a`
  - **Files likely touched**: `crates/engine/src/audio_source.rs`, `crates/engine/src/http/routes_stream.rs`, `crates/engine/src/http/mod.rs`, `crates/engine/tests/audio_source_and_stream_test.rs`
  - **Estimated scope**: `S`

- [ ] **Task 6 (`task-6`): Audio Metadata/Cover Extraction (`lofty`) & Thumbnail Variants (`/api/thumbs/:id`)**
  - **Description**: Port `/api/thumbs/:id` (`src/server/thumbnails.ts`) and local metadata/cover-art extraction (`src/server/ingest.ts`). Port tests from `thumbnails.test.ts`.
  - **Acceptance criteria**:
    - [ ] Strips optional `.jpg`/`.png`/`.webp` extension from `/api/thumbs/:id`, scales down `?size=small|large` (`192px`/`640px`) via 2-slot FIFO semaphore + `.partial.jpg` atomic rename + `cover_art_version` check, and gracefully serves the original thumbnail if `?size` is missing/invalid or scaling fails.
    - [ ] Extracts local track metadata + cover art (`<= 4 MiB`, JPEG/PNG/WebP magic bytes) and returns `/api/thumbs/${trackId}${ext}?v=${md5_8char}`.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test thumbnails_test`
  - **Dependencies**: `task-3a`
  - **Files likely touched**: `crates/engine/src/metadata.rs`, `crates/engine/src/thumbnails.rs`, `crates/engine/src/http/routes_thumbs.rs`, `crates/engine/tests/thumbnails_test.rs`
  - **Estimated scope**: `M`

- [ ] **Checkpoint 2**: Verify Phase 2 Audio Analysis, Range Streaming, Metadata & Thumbnail Parity
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`

---

## Phase 3: Ingest Engine (`yt-dlp` / Local / Uploads / Video) & Atomic `.tar.gz` Backup/Restore

- [ ] **Task 7 (`task-7`): Port YouTube, Local File/Directory & Retry Ingest Pipeline**
  - **Description**: Port `POST /api/tracks/ingest-youtube`, `POST /api/tracks/ingest-local`, `POST /api/tracks/retry-all`, and `POST /api/tracks/:id/retry` (`src/server/ingest.ts`). Port tests from `ingest.test.ts`.
  - **Acceptance criteria**:
    - [ ] Dynamic JS runtime probing (`bun`, `node`, `deno`, `quickjs`), 2-slot metadata semaphore (queue depth 20), 5-min cookie cooldown, fallback client retry, playlist batching (`MAX_PLAYLIST_ITEMS = 5000`), and sequential download worker (`concurrency = 1`) with single-pass peaks+loudness persistence and `reconcile_track_segments`.
    - [ ] `POST /api/tracks/ingest-local` validates `validate_safe_local_audio_path` before filesystem access and supports single files and directories (up to 50 paths / 100 files per dir).
    - [ ] `cancel_download_if_active` and `abort_ingest_processes` kill child process trees and await all in-flight `active_ingest_operations`.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test ingest_test`
  - **Dependencies**: `task-4`, `task-6`
  - **Files likely touched**: `crates/engine/src/ingest/mod.rs`, `crates/engine/src/ingest/ytdlp.rs`, `crates/engine/src/ingest/local.rs`, `crates/engine/src/http/routes_ingest.rs`, `crates/engine/tests/ingest_test.rs`
  - **Estimated scope**: `M`

- [ ] **Task 8 (`task-8`): Port Multipart Audio & `.mp4` Video Upload Pipeline (`POST /api/tracks/upload`)**
  - **Description**: Port `POST /api/tracks/upload` (`ingestUploadedFile`) and `extractAudioFromVideo` (`src/server/audioExtractor.ts`). Port tests from `audioExtractor.test.ts`.
  - **Acceptance criteria**:
    - [ ] Accepts `"files"` and `"file"` fields (1..=20 files, `300 MiB` per file, `305 MiB` body cap), hashes content (`loc_${md5_12char}`), extracts `.mp4` audio via `ffprobe` + `ffmpeg -vn -c:a copy` (30s) -> `-c:a aac -b:a 256k` (60s fallback), and returns `200 { success: true, tracks, message }`.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test audio_extractor_test`
  - **Dependencies**: `task-7`
  - **Files likely touched**: `crates/engine/src/ingest/upload.rs`, `crates/engine/src/ingest/video_extractor.rs`, `crates/engine/src/http/routes_ingest.rs`, `crates/engine/tests/audio_extractor_test.rs`
  - **Estimated scope**: `S`

- [ ] **Task 9 (`task-9`): Port Gzipped Tar Export & Two-Phase Atomic Restore (`/api/library/export` & `/api/library/import`)**
  - **Description**: Port `src/server/backup.ts`, `src/server/archiveWriter.ts`, and `src/server/backupLimits.ts`. Port tests from `backupLimits.test.ts`, `backup.test.ts`, and `restoreIngest.test.ts`.
  - **Acceptance criteria**:
    - [ ] `GET /api/library/export` runs `VACUUM INTO`, normalizes external audio paths to full 64-char SHA-256 `local_${sha256_hex(id)}${ext}`, aborts if any `ready` track is missing audio on disk, **excludes `cookies.txt` by default (`include_cookies = false`)**, enforces `assert_export_fits_restore`, and streams `slice-player-backup-${timestamp}.tar.gz`.
    - [ ] `POST /api/library/import` pauses ingest/mutations/loudness, validates `is_safe_archive_filename` and size quotas, checks `PRAGMA quick_check` + `tracks`/`segments` tables, stages `.incoming` files, awaits `abort_ingest_processes()` + `drain_library_mutations()` (with deterministic test synchronization hook for `restoreIngest.test.ts` parity), swaps `.previous`/`.incoming` (including `-wal`/`-shm`) with full rollback on error, runs `init_database` + `heal_track_file_paths`, and emits `library_restored` + `playlist_items_changed`.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test backup_and_restore_test`
  - **Dependencies**: `task-3b`, `task-4`, `task-7`
  - **Files likely touched**: `crates/engine/src/backup/mod.rs`, `crates/engine/src/backup/limits.rs`, `crates/engine/src/backup/export.rs`, `crates/engine/src/backup/import.rs`, `crates/engine/tests/backup_and_restore_test.rs`
  - **Estimated scope**: `M`

- [ ] **Checkpoint 3**: Verify Phase 3 Ingest, Upload, and Atomic Backup/Restore Parity
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`

---

## Phase 4: Optional Tauri v2 Wrapper, Full-Stack Verification & Legacy Cleanup

- [ ] **Task 10 (`task-10`): Scaffold Optional `src-tauri` Desktop Wrapper & Update `src/launcher/refresh.ts`**
  - **Description**: Create `src-tauri` (kept in `exclude = ["src-tauri"]` in root `Cargo.toml` so headless hosts without `webkit2gtk-4.1` never fail workspace builds) and update `src/launcher/refresh.ts` to watch `crates/engine/src`, `Cargo.toml`, and `crates/engine/Cargo.toml` (excluding `crates/engine/tests`) and rebuild `slice-server` when Rust sources change.
  - **Acceptance criteria**:
    - [ ] `src-tauri/src/main.rs` boots `slice_engine` and points the Tauri window to `http://127.0.0.1:3000`.
    - [ ] `src/launcher/refresh.ts` watches `crates/engine/src`, `Cargo.toml`, and `crates/engine/Cargo.toml` (ignoring Rust test files), rebuilds `slice-server` when stale, and passes `bun test --isolate src/launcher`.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun test --isolate src/launcher`
  - **Dependencies**: `task-9`
  - **Files likely touched**: `Cargo.toml`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src/launcher/refresh.ts`
  - **Estimated scope**: `S`

- [ ] **Task 11 (`task-11`): Full-Stack Integration Verification & Live Browser Inspection (`agent-browser`)**
  - **Description**: Add `security_and_concurrency_test.rs`, wire `package.json` and `start.bat` to build/run `slice-server`, and verify the live app in `agent-browser`.
  - **Acceptance criteria**:
    - [ ] All Rust integration tests, client unit tests (`bun test --isolate src/client src/launcher`), typechecks (`bun run typecheck`), lints (`bun run lint`), and Playwright E2E tests (`bun run test:e2e`) pass.
    - [ ] Live inspection in `agent-browser` against `slice-server` on `http://127.0.0.1:3000` confirms zero console/page/network errors, working `/ws`, tracks/segments/playlists/mix/sub-playlists, `206` audio streaming, and backup export.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun test --isolate src/client src/launcher && bun run typecheck && bun run lint`
  - **Dependencies**: `task-10`
  - **Files likely touched**: `crates/engine/tests/security_and_concurrency_test.rs`, `package.json`, `start.bat`
  - **Estimated scope**: `M`

- [ ] **Task 12 (`task-12`): Retire Legacy Bun Server Runtime Files (Retaining `src/server/types.ts`)**
  - **Description**: Remove deprecated runtime `.ts` and `.test.ts` files in `src/server/` while **retaining `src/server/types.ts`**, and prune unused server-only npm packages (`music-metadata`, `tar-stream`, `@types/tar-stream`).
  - **Acceptance criteria**:
    - [ ] `src/server/types.ts` is preserved so `bun run typecheck`, `bun run lint`, `bun test --isolate`, and `bun run build` succeed with zero errors.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun run typecheck && bun run lint && bun test --isolate && bun run build`
  - **Dependencies**: `task-11`
  - **Files likely touched**: `package.json`, `src/server/` (retain `src/server/types.ts`)
  - **Estimated scope**: `S`

- [ ] **Checkpoint 4**: Final Cutover, E2E & Live Browser (`agent-browser`) Verification
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun run typecheck && bun run lint && bun test --isolate && bun run test:e2e`
