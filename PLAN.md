# Picnic Desktop (Unofficial)

Cross-platform desktop clone (Windows + macOS, Linux free extra) of Picnic iOS app (https://www.picnic.photos/) photo-sorting behavior.

## Core Behavior

1. App asks user to pick a directory.
2. Scan dir + subdirs recursively for images (jpg, jpeg, png, heic, webp, gif, bmp).
3. Sort found images by date (EXIF date taken, fallback to file modified date).
4. Show one image at a time, fullscreen/card view.
5. Swipe/gesture or keyboard:
   - Left swipe or **Left arrow** (or A) = delete pic → send to Recycle Bin/Trash (not permanent delete).
   - Right swipe or **Right arrow** (or D) = keep pic → record path as "kept".
   - Arrow keys are first-class for rapid triage: instant action on keydown, no animation blocking — user can hammer arrows to sort fast. Preload next few images so keyboard speed never waits on disk.
6. Kept paths persisted to disk (e.g. JSON or SQLite db in app data folder).
7. On next scan, images with paths already in "kept" list are skipped/filtered out — not shown again.
8. Deleted images obviously don't need filtering (they're gone from disk).

## Tech Stack Options

- **Electron + React** — easiest swipe UI (touch/mouse drag), Node fs access, recycle-bin/Trash delete via `shell.trashItem()`. Ships Chromium: ~150MB+, pixel-identical rendering on all platforms, JS-only. Note: Chromium cannot decode HEIC — iPhone photos need conversion step.
- **Tauri + React/Svelte** — ~10MB binary, Rust backend, `trash` crate handles Windows Recycle Bin + macOS Trash with same API, fast dir scanning. Uses OS webview (WebView2 on Windows, WKWebView on macOS) — WKWebView decodes HEIC natively on Mac.
- **.NET (WPF/WinUI 3)** — Windows-only; rejected since macOS is a target.

Recommendation: **Tauri** — lightweight, fast image loading, cross-platform trash support, native HEIC on macOS. Pick Electron only if avoiding Rust is a priority.

## Data Model

```
kept.json — stored in Tauri app_data_dir():
  Windows: %APPDATA%/picnic-desktop/kept.json
  macOS:   ~/Library/Application Support/picnic-desktop/kept.json
{
  "keptPaths": ["C:\\Photos\\2024\\img001.jpg", ...]
}
```

Consider per-directory kept list (keyed by scanned root dir) vs global list — per-directory scoping avoids collisions if same filename appears under different roots. Use absolute path as key regardless.

## Scan & Sort Pipeline

1. Walk dir tree (async, non-blocking) collecting image file paths.
2. Read EXIF `DateTimeOriginal` per file (lib: `exif` / `kamadak-exif` in Rust, or `exifr` in JS).
3. Fallback to filesystem modified time if no EXIF date.
4. Sort ascending or descending by date (match Picnic: likely oldest-first or newest-first — confirm with user preference, default newest-first).
5. Filter out any path present in `kept.json` for that root.
6. Feed remaining list into swipe queue.

## UI Flow

- **Screen 1**: "Choose folder to sort" button → native folder picker.
- **Screen 2**: Scanning progress (count of images found).
- **Screen 3**: Swipe deck — current image centered, drag left/right with visual tilt + color overlay (red = delete, green = keep), buttons as fallback for non-touch. Keyboard: Left/Right arrows trigger delete/keep immediately — animations are fire-and-forget so held/rapid keypresses queue actions without lag. Preload buffer (next ~5 images decoded) keeps pace with fast keyboard sorting.
- **Screen 4**: "All done" when queue empty, shows stats (kept X, deleted Y).
- Undo last action (optional nice-to-have, Picnic has this) — keep small history stack in memory for session undo.

## Delete Safety

- Never hard-delete. Always send to OS Recycle Bin (Windows) / Trash (macOS) so user can recover — `trash` crate abstracts both.
- Confirm on first-run with a small info toast: "Deleted photos go to Recycle Bin / Trash."

## Milestones

1. Project scaffold (Tauri + React/TS).
2. Folder picker + recursive image scan + EXIF/mtime sort.
3. Kept-list persistence + filtering on rescan.
4. Swipe UI (mouse drag + keyboard) with delete-to-recycle-bin and keep-to-list.
5. Undo last swipe.
6. Progress/stats screen.
7. Packaging via Tauri bundler: `.msi`/`.exe` (Windows), `.dmg`/`.app` (macOS). Note: macOS build requires a Mac (no cross-compile); unsigned `.app` triggers Gatekeeper warning — Apple dev cert needed for clean distribution.

## Open Questions

- Sort order: oldest→newest or newest→oldest first? (default newest-first, confirm)
- Should "kept" list be global or per-scanned-folder? (default per-folder)
- Support videos too, or images only? (default images only, matches Picnic)
- Multi-select / batch actions needed, or strictly one-at-a-time swipe?
