# Task Checklist: Direction 1 — Pure-Rust Engine (`crates/engine`) + Desktop Shell Migration

Plan details: [plan.md](file:///home/gohans-linux/projects/slice-player/tasks/plan.md)

## Phase 1: Cargo Workspace, SQLite `./data/music.db` Parity & Core HTTP/CRUD Server

- [x] **Task 1 (`task-1`): Initialize Cargo Workspace & `crates/engine` Skeleton**
  - **Description**: Create root `Cargo.toml` (`members = ["crates/engine"]`, `default-members = ["crates/engine"]`, `exclude = ["src-tauri"]`) and `crates/engine` (`slice-engine` lib + `slice-server` bin) with `EngineConfig` and `appWindow` single-instance/window-launcher/idle-shutdown helpers (`appWindow.test.ts` parity).
  - **Acceptance criteria**:
    - [x] `crates/engine` compiles with zero warnings and exports `EngineConfig` + `appWindow` helpers (`find_app_browser`, `is_server_running`, `open_app_window`, safe `<exe_dir>/dist` chdir check).
    - [x] `WsLifecycleTracker::wait_for_shutdown(is_busy)`: 180s no-client startup watchdog + 60s idle shutdown after last disconnect (restart on reconnect, re-arm while ingest busy), proven with paused Tokio time in `app_window_test.rs`. *(Reopened after review: only the WS counter existed. Binary wiring → Task 9b.)*
    - [x] `.gitignore` excludes `/target`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test app_window_test`
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
    - [x] Migration test upgrades a **real legacy `user_version = 0` schema** (tracks without `volume`/`loudness`/`true_peak`, no playlist tables) with representative rows, asserting new columns + defaults, preserved rows, `sqp=` rewrite, all tables/indexes at v11, and data intact after close + reopen. *(Reopened after review: old test rewound `user_version` on the latest schema. Fixed with fixtures from git `30acfe7^` and `ba7e6e8`.)*
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test db_test`
  - **Dependencies**: `task-1`
  - **Files likely touched**: `crates/engine/src/db/mod.rs`, `crates/engine/src/db/migrations.rs`, `crates/engine/src/db/maintenance.rs`, `crates/engine/src/models.rs`, `crates/engine/tests/db_test.rs`
  - **Estimated scope**: `M`

- [x] **Task 3a (`task-3a`): Security Middleware, `/ws` Hub, Logs, Weak ETag & Tracks/Segments CRUD Routes**
  - **Description**: Port security middleware (`Host`, `Origin`, `Sec-Fetch-Site`, payload caps, `libraryRequests` mutation tracking), `/ws` WebSocket hub (`websocketEvents.ts`), `/api/logs` (`logger.ts`), weak ETag helper (`etag.ts`), static `./dist` serving, and Tracks/Segments CRUD routes. Port tests from `etag.test.ts`, `logger.test.ts`, `websocketEvents.test.ts`, and `security.test.ts`.
  - **Acceptance criteria**:
    - [x] Enforces `Host`, `Origin`, `Sec-Fetch-Site: cross-site`, `Transfer-Encoding: chunked` (`400`), `Content-Length` (`411`/`413`), and `503 Retry-After: 5` during restore (`pause_library_mutations` / `drain_library_mutations`).
    - [x] `/ws` sends `{"type":"connected"}`, replies `"pong"` to `"ping"`, and broadcasts all 14 `websocketEvents.ts` event types.
    - [x] Implements `GET /api/logs`, `DELETE /api/logs` (with `sanitize_internal_paths`), `GET /api/tracks` (weak ETag `304`, omits `peaks_json`, attaches `download_index`), `GET /api/tracks/:id` (with `peaks_json`), `PUT/PATCH /api/tracks/:id` (resets `loudness`/`true_peak` when `file_path` changes unless explicitly supplied in the same update payload), `DELETE /api/tracks/:id`, `POST /api/tracks/batch-delete`, `GET /api/tracks/:id/segments`, `POST /api/tracks/:id/segments`, `PUT /api/segments/:id`, `DELETE /api/segments/:id`, `POST /api/segments/batch-delete`, and `GET /api/segments` (weak ETag `304`).
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test http_and_crud_test`
  - **Dependencies**: `task-2`
  - **Files likely touched**: `crates/engine/src/http/mod.rs`, `crates/engine/src/http/security.rs`, `crates/engine/src/http/ws_and_logs.rs`, `crates/engine/src/http/routes_tracks_segments.rs`, `crates/engine/src/db/tracks_segments.rs`
  - **Estimated scope**: `M`

- [x] **Task 3b (`task-3b`): Playlists, Mix Playlists, 1-Level Sub-Playlists, Plays & Home Summary Routes**
  - **Description**: Port playlist CRUD, 1-level sub-playlists (`parent_id` auto-bubbling & cascade removal), live mix playlists (`is_mix`, `playlist_sources`), play history (`POST /api/plays`), and Home shelves (`GET /api/home`). Port tests from `mixPlaylist.test.ts`, `subPlaylist.test.ts`, and `plays.test.ts`.
  - **Acceptance criteria**:
    - [x] Implements `GET /api/playlist-memberships`, `GET /api/playlists`, `POST /api/playlists`, `POST /api/playlists/mix`, `PUT /api/playlists/:id/sources`, `PUT /api/playlists/:id/reorder`, `GET /api/playlists/:id`, `PATCH /api/playlists/:id`, `DELETE /api/playlists/:id` (`keep_children` support), `POST /api/playlists/:id/items`, `POST /api/playlists/:id/items/batch`, `DELETE /api/playlists/:id/items/:itemId`, and `POST /api/playlists/:id/items/batch-delete`.
    - [x] Adding items to a sub-playlist auto-bubbles `(track_id, segment_id)` to `parent_id`; removing items from a parent playlist cascades deletion to all child sub-playlists.
    - [x] Implements `POST /api/plays` (`204 No Content`) and `GET /api/home` (`recently_played`, `heavy_rotation`, `top_playlists`).
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test playlists_and_plays_test`
  - **Dependencies**: `task-3a`
  - **Files likely touched**: `crates/engine/src/db/playlists.rs`, `crates/engine/src/db/plays.rs`, `crates/engine/src/http/routes_playlists.rs`, `crates/engine/src/http/routes_plays.rs`, `crates/engine/tests/playlists_and_plays_test.rs`
  - **Estimated scope**: `M`

- [x] **Checkpoint 1**: Verify Phase 1 SQLite, Security, WebSocket, Tracks, Segments, Playlists, Mix/Sub-Playlists & Plays Parity
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`

---

## Phase 2: Pure-Rust Single-Pass Audio Analyzer, Range Streaming & Thumbnails

- [x] **Task 4 (`task-4`): Single-Pass Streaming Audio Analyzer (`symphonia` + `libopus` + `ebur128`) & Loudness Worker**
  - **Description**: Replace `src/server/waveform.ts` and `src/server/loudness.ts` with a single-pass `O(1)` streaming decoder (`symphonia` + `symphonia-adapter-libopus` + `ebur128` + `ffmpeg` fallback) and background `measure_missing_loudness` worker. Port tests from `loudness.test.ts`.
  - **Acceptance criteria**:
    - [x] Registers `symphonia_adapter_libopus::OpusDecoder` so `.opus`/`.webm` (`format 251`) and all standard formats decode in-process.
    - [x] Mono measured like legacy `ffmpeg ebur128` (**no** `DualMono`), converts linear true peak via `20.0 * max_linear.log10()`, returns `None` on non-finite silence, and computes `1,000` peaks (`[0.0, 1.0]` absolute amplitude, 3 decimals, `1800s` cap) with `ffmpeg` CLI and `[0.1; 1000]` fallbacks. *(ffmpeg fallback = ffmpeg decodes to a WAV pipe, same Rust meter/envelope. Waveform intentionally differs from legacy's ~100 Hz low-passed envelope; see plan Task 4 note.)*
    - [x] Parity fixture: native mono + stereo results match legacy `ffmpeg ... ebur128=peak=true` summary (`I` ±0.1 LU, `Peak` ±0.2 dB).
    - [x] Background `measure_missing_loudness()` measures `status = 'ready' AND loudness IS NULL` newest first, announces `track_updated` (`reason: "loudness"`), and pauses cleanly via `pause_measuring_loudness()`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test loudness_and_waveform_test`
  - **Dependencies**: `task-2`, `task-3a`
  - **Files likely touched**: `crates/engine/src/audio_analysis/mod.rs`, `crates/engine/src/audio_analysis/decoder.rs`, `crates/engine/src/audio_analysis/loudness_worker.rs`, `crates/engine/tests/loudness_and_waveform_test.rs`
  - **Estimated scope**: `M`

- [x] **Task 5 (`task-5`): Read-Only Fallback Audio Source & HTTP Byte-Range Streaming (`/api/tracks/:id/stream`)**
  - **Description**: Port `resolveAudioSource` (`src/server/audioSource.ts`) and `GET/HEAD /api/tracks/:id/stream` (`200`, `206`, `416`, `403`, `404`). Port tests from `audioSource.test.ts`.
  - **Acceptance criteria**:
    - [x] `resolve_audio_source` validates `validate_safe_local_audio_path` (`403`) and falls back to `./data/cache/audio/<basename>` **read-only without mutating SQLite**.
    - [x] Serves `.opus` as `audio/ogg` and handles `HEAD` and `GET` byte-range requests (`206 Partial Content` and `416 Range Not Satisfiable`).
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test audio_source_and_stream_test`
  - **Dependencies**: `task-3a`
  - **Files likely touched**: `crates/engine/src/audio_source.rs`, `crates/engine/src/http/routes_stream.rs`, `crates/engine/src/http/mod.rs`, `crates/engine/tests/audio_source_and_stream_test.rs`
  - **Estimated scope**: `S`

- [x] **Task 6 (`task-6`): Audio Metadata/Cover Extraction (`lofty`) & Thumbnail Variants (`/api/thumbs/:id`)**
  - **Description**: Port `/api/thumbs/:id` (`src/server/thumbnails.ts`) and local metadata/cover-art extraction (`src/server/ingest.ts`). Port tests from `thumbnails.test.ts`.
  - **Acceptance criteria**:
    - [x] Strips optional `.jpg`/`.png`/`.webp` extension from `/api/thumbs/:id`, scales down `?size=small|large` (`192px`/`640px`) via 2-slot FIFO semaphore + `.partial.jpg` atomic rename + `cover_art_version` check, and gracefully serves the original thumbnail if `?size` is missing/invalid or scaling fails.
    - [x] Extracts local track metadata + cover art (`<= 4 MiB`, JPEG/PNG/WebP magic bytes) and returns `/api/thumbs/${trackId}${ext}?v=${md5_8char}`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test thumbnails_test`
  - **Dependencies**: `task-3a`
  - **Files likely touched**: `crates/engine/src/metadata.rs`, `crates/engine/src/thumbnails.rs`, `crates/engine/src/http/routes_thumbs.rs`, `crates/engine/tests/thumbnails_test.rs`
  - **Estimated scope**: `M`

- [x] **Checkpoint 2**: Verify Phase 2 Audio Analysis, Range Streaming, Metadata & Thumbnail Parity
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`

---

## Phase 3: Ingest Engine (`yt-dlp` / Local / Uploads / Video) & Atomic `.tar.gz` Backup/Restore

- [x] **Task 7 (`task-7`): Port YouTube, Local File/Directory & Retry Ingest Pipeline**
  - **Description**: Port `POST /api/tracks/ingest-youtube`, `POST /api/tracks/ingest-local`, `POST /api/tracks/retry-all`, and `POST /api/tracks/:id/retry` (`src/server/ingest.ts`). Port tests from `ingest.test.ts`.
  - **Acceptance criteria**:
    - [x] JS runtimes `--js-runtimes bun --js-runtimes node` exactly as `getYouTubeAuthArgs` passes them (the plan's "dynamic probing" never existed in the legacy code), 2-slot metadata semaphore (queue depth 20), 5-min cookie cooldown, fallback client retry, playlist batching (`MAX_PLAYLIST_ITEMS = 5000`), and sequential download worker (`concurrency = 1`) with single-pass peaks+loudness persistence and `reconcile_track_segments`.
    - [x] `POST /api/tracks/ingest-local` validates `validate_safe_local_audio_path` before filesystem access and supports single files and directories (up to 50 paths / 100 files per dir).
    - [x] `cancel_download_if_active` and `abort_ingest_processes` kill child process trees and await all in-flight `active_ingest_operations`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test ingest_test`
  - **Dependencies**: `task-4`, `task-6`
  - **Files likely touched**: `crates/engine/src/ingest/mod.rs`, `crates/engine/src/ingest/ytdlp.rs`, `crates/engine/src/ingest/local.rs`, `crates/engine/src/http/routes_ingest.rs`, `crates/engine/tests/ingest_test.rs`
  - **Estimated scope**: `M`

- [x] **Task 8 (`task-8`): Port Multipart Audio & `.mp4` Video Upload Pipeline (`POST /api/tracks/upload`)**
  - **Description**: Port `POST /api/tracks/upload` (`ingestUploadedFile`) and `extractAudioFromVideo` (`src/server/audioExtractor.ts`). Port tests from `audioExtractor.test.ts`.
  - **Acceptance criteria**:
    - [x] Accepts `"files"` and `"file"` fields (1..=20 files, `300 MiB` per file, `305 MiB` body cap), hashes content (`loc_${md5_12char}`), extracts `.mp4` audio via `ffprobe` + `ffmpeg -vn -c:a copy` (30s) -> `-c:a aac -b:a 256k` (60s fallback), and returns `200 { success: true, tracks, message }`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test audio_extractor_test`
  - **Dependencies**: `task-7`
  - **Files likely touched**: `crates/engine/src/ingest/upload.rs`, `crates/engine/src/ingest/video_extractor.rs`, `crates/engine/src/http/routes_ingest.rs`, `crates/engine/tests/audio_extractor_test.rs`
  - **Estimated scope**: `S`

- [x] **Task 9 (`task-9`): Port Gzipped Tar Export & Two-Phase Atomic Restore (`/api/library/export` & `/api/library/import`)**
  - **Description**: Port `src/server/backup.ts`, `src/server/archiveWriter.ts`, and `src/server/backupLimits.ts`. Port tests from `backupLimits.test.ts`, `backup.test.ts`, and `restoreIngest.test.ts`.
  - **Acceptance criteria**:
    - [x] `GET /api/library/export` runs `VACUUM INTO`, normalizes external audio paths to full 64-char SHA-256 `local_${sha256_hex(id)}${ext}`, aborts if any `ready` track is missing audio on disk, **excludes `cookies.txt` by default (`include_cookies = false`)**, enforces `assert_export_fits_restore`, and streams `slice-player-backup-${timestamp}.tar.gz`.
    - [x] `POST /api/library/import` pauses ingest/mutations/loudness, validates `is_safe_archive_filename` and size quotas, checks `PRAGMA quick_check` + `tracks`/`segments` tables, stages `.incoming` files, awaits `abort_ingest_processes()` + `drain_library_mutations()` (with deterministic test synchronization hook for `restoreIngest.test.ts` parity), swaps `.previous`/`.incoming` (including `-wal`/`-shm`) with full rollback on error, runs `init_database` + `heal_track_file_paths`, and emits `library_restored` + `playlist_items_changed`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test backup_and_restore_test`
  - **Dependencies**: `task-3b`, `task-4`, `task-7`
  - **Files likely touched**: `crates/engine/src/backup/mod.rs`, `crates/engine/src/backup/limits.rs`, `crates/engine/src/backup/export.rs`, `crates/engine/src/backup/import.rs`, `crates/engine/tests/backup_and_restore_test.rs`
  - **Estimated scope**: `M`

- [x] **Checkpoint 3**: Verify Phase 3 Ingest, Upload, and Atomic Backup/Restore Parity
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine`

---

## Phase 4: Runtime Wiring, Optional Tauri v2 Wrapper, Full-Stack Verification & Legacy Cleanup

- [x] **Task 9b (`task-9b`): `slice-server` Runtime Wiring (`start_server`, Startup Sequence, Lifecycle & Graceful Shutdown)**
  - **Description**: Port the `index.ts` boot sequence into `slice_engine::start_server(config)` and make `slice-server` call it (today the binary only prints a line and exits).
  - **Acceptance criteria**:
    - [x] Legacy boot order: exe-dir chdir → production single-instance check → `Db::open` (migrations + orphan sweep + path heal) → `recover_incomplete_ingests` → loudness worker (+ re-trigger on `track_created`/`track_updated`) → bind `127.0.0.1:<port>` → open app window in production.
    - [x] Production lifecycle uses `wait_for_shutdown(is_ingest_busy)`; SIGINT/SIGTERM/Ctrl-Break → graceful shutdown (stop accepting, abort ingest + analysis, `Db::close` WAL checkpoint, exit 0).
    - [x] `server_runtime_test.rs` boots `start_server` on an ephemeral port in a temp cwd: `/api/tracks` answers, `/ws` sends `connected`, pre-seeded `downloading` track becomes `error`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine --test server_runtime_test`
  - **Dependencies**: `task-3b`, `task-4`
  - **Files likely touched**: `crates/engine/src/lib.rs`, `crates/engine/src/server.rs`, `crates/engine/src/bin/slice-server.rs`, `crates/engine/tests/server_runtime_test.rs`
  - **Estimated scope**: `S`

- [x] **Task 10 (`task-10`): Scaffold Optional `src-tauri` Desktop Wrapper & Update `src/launcher/refresh.ts`**
  - **Description**: Create `src-tauri` (kept in `exclude = ["src-tauri"]` in root `Cargo.toml` so headless hosts without `webkit2gtk-4.1` never fail workspace builds) and update `src/launcher/refresh.ts` to watch `crates/engine/src`, `Cargo.toml`, and `crates/engine/Cargo.toml` (excluding `crates/engine/tests`) and rebuild `slice-server` when Rust sources change.
  - **Acceptance criteria**:
    - [x] `src-tauri/src/main.rs` boots `slice_engine` and points the Tauri window to `http://127.0.0.1:3000`.
    - [x] `src/launcher/refresh.ts` watches `crates/engine/src`, `Cargo.toml`, and `crates/engine/Cargo.toml` (ignoring Rust test files), rebuilds `slice-server` when stale, and passes `bun test --isolate src/launcher`.
    - [ ] *(Optional, only if Tauri ships)* Playback smoke test inside the real WebView per OS (Linux WebKitGTK depends on GStreamer codecs even over HTTP loopback).
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun test --isolate src/launcher`
  - **Dependencies**: `task-9`, `task-9b`
  - **Files likely touched**: `Cargo.toml`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src/launcher/refresh.ts`
  - **Estimated scope**: `S`

- [x] **Task 11 (`task-11`): Full-Stack Integration Verification, Real-Backend E2E & Cutover Rehearsal**
  - **Description**: Add `security_and_concurrency_test.rs`, a Playwright suite against the **real** `slice-server`, rehearse cutover on a copy of the real library, wire `package.json` / `start.bat` to `slice-server` while keeping `start:bun` for rollback, and verify the live app in `agent-browser`.
  - **Acceptance criteria**:
    - [x] All Rust integration tests, client unit tests (`bun test --isolate src/client src/launcher`), typechecks (`bun run typecheck`), lints (`bun run lint`), and the existing mocked Playwright suite (`bun run test:e2e`) pass.
    - [x] `bun run test:e2e:rust` (`playwright.rust.config.ts`): `webServer` = `target/release/slice-server` in a fresh temp cwd (`dist` symlinked, throwaway `./data`), **no** API/WS mocks; covers `/ws` + live `track_updated`, local ingest → waveform → `206` stream, segment/playlist/mix/sub-playlist CRUD, and export → import round-trip.
    - [x] Live inspection in `agent-browser` against `slice-server` on `http://127.0.0.1:3000` confirms zero console/page/network errors.
    - [x] Cutover rehearsal on copies of `./data` (SQLite `.backup` snapshot, Bun stopped): API JSON diff Bun vs Rust (`/api/tracks` `631,083`B, `/api/segments` `379`B, `/api/playlists` `11,392`B, `/api/home` `2,797`B — all 4 endpoints **100% byte-identical**) + cache listing diff before/after Rust boot (`1,299` before -> `1,265` after on both Bun and Rust, `0` divergence).
    - [x] Rollback ready: consistent snapshot of the real `./data` stored outside the repo at `/home/gohans-linux/projects/slice-player-data-pre-rust-cutover-snapshot` (`cookies.txt` `0600`); `start:bun` / `dev:bun` scripts and `start.bat --bun` kept; rollback procedure:
      1. Stop `slice-server` (`pkill -TERM slice-server` or Ctrl+C).
      2. Remove current DB + WAL/SHM and restore snapshot: `rm -f data/music.db data/music.db-wal data/music.db-shm && cp /home/gohans-linux/projects/slice-player-data-pre-rust-cutover-snapshot/music.db data/music.db && rm -rf data/cache && cp -al /home/gohans-linux/projects/slice-player-data-pre-rust-cutover-snapshot/cache data/cache`.
      3. Start legacy Bun backend: `bun run start:bun` (or `start.bat --bun` on Windows).
    - [ ] After acceptance: one-off job (`./target/release/slice-server --reanalyze-waveforms`) re-generates `peaks_json` for every track so old and new waveforms match (dev decision 2026-10-19; implemented & tested, awaiting dev go-ahead on live `./data`).
    - [x] *(Optional)* Baselines:
      - **3-min stereo MP3**: Bun+2x`ffmpeg` `wall=1305.6ms`, `VmHWM=30.3MiB` (+2 child `ffmpeg` procs) vs Rust `slice-server` `wall=517.4ms` (**2.52x faster**), `VmHWM=12.4MiB`, `/api/tracks` latency while analyzing `p50=0.52ms`, `p99=0.67ms`.
      - **30-min stereo MP3**: Bun+2x`ffmpeg` `wall=11581.1ms`, `VmHWM=39.3MiB` (+2 child `ffmpeg` procs) vs Rust `slice-server` `wall=5413.0ms` (**2.14x faster**), `VmHWM=13.9MiB`, `/api/tracks` latency while analyzing `p50=0.57ms`, `p99=0.74ms`.
  - **Verification**:
    - [x] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun test --isolate src/client src/launcher && bun run typecheck && bun run lint && bun run test:e2e && bun run test:e2e:rust`
  - **Dependencies**: `task-10`
  - **Files likely touched**: `crates/engine/tests/security_and_concurrency_test.rs`, `playwright.rust.config.ts`, `e2e/rust-backend/*.spec.ts`, `package.json`, `start.bat`
  - **Estimated scope**: `M`

- [ ] **Task 12 (`task-12`): Retire Legacy Bun Server Runtime Files (Retaining `src/server/types.ts`)** — ⚠️ one-way door, needs the dev's explicit go after running Rust on the real library
  - **Description**: Remove deprecated runtime `.ts` and `.test.ts` files in `src/server/` while **retaining `src/server/types.ts`**, drop `start:bun` / `dev:bun`, and prune unused server-only npm packages (`music-metadata`, `tar-stream`, `@types/tar-stream`).
  - **Acceptance criteria**:
    - [ ] `src/server/types.ts` is preserved so `bun run typecheck`, `bun run lint`, `bun test --isolate`, and `bun run build` succeed with zero errors.
  - **Verification**:
    - [ ] Tests pass: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun run typecheck && bun run lint && bun test --isolate && bun run build`
  - **Dependencies**: `task-11` + dev acceptance
  - **Files likely touched**: `package.json`, `src/server/` (retain `src/server/types.ts`)
  - **Estimated scope**: `S`

- [x] **Checkpoint 4**: Final Cutover, E2E & Live Browser (`agent-browser`) Verification
  - **Verification**: `PATH="$HOME/.cargo/bin:$PATH" cargo test -p slice-engine && bun run typecheck && bun run lint && bun test --isolate && bun run test:e2e && bun run test:e2e:rust`
