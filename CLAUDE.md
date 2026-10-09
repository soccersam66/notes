# Notes app: guide for Claude Code

Sam's personal class-notes web app for his iPad. Hosted on GitHub Pages from `main` (repo root is published). All app files live in the `notes-app/` folder, so the live app is https://soccersam66.github.io/notes/notes-app/. Pushing to `main` updates it within a couple of minutes.

**Keep the app in `notes-app/`.** Do not move it to the repo root: the URL (and the installed home-screen app on the iPad) must stay the same. Every path below is relative to `notes-app/` unless it starts with the repo root.

## Hard rules
- Never use em dashes anywhere (code comments, UI text, commit messages, replies). Use commas, colons, parentheses or plain hyphens. They show up garbled for Sam.
- Never commit API keys, tokens or any secret. This repo is PUBLIC. Gemini keys live only in the app's IndexedDB on the iPad (Settings), never in files.
- Target device: iPad 7th gen (2019, A10, 3 GB RAM) stuck on iPadOS 17, so Safari 17. Apple Pencil 1st gen. Do not use features newer than Safari 17 (no CSS `@scope`, no `Promise.withResolvers` without fallback, no View Transitions API, etc.).
- No build step. Plain ES modules, vanilla JS, no frameworks, no npm runtime deps. Files are served as-is.
- Keep the design: Cal AI-like, minimal, system font, rounded cards, spring animations (cubic-bezier(.2,1.3,.35,1)), light/dark, one accent (black, blue #2F5BEA or green #18794A). CSS tokens are in `notes-app/css/app.css` `:root`.
- Memory matters on the old iPad: the editor only mounts pages near the viewport (IntersectionObserver). Keep it that way. A past app crashed from too many PDF page images in memory.
- Free tiers only (spending freeze). No paid services.

## Layout (all inside `notes-app/`)
- `notes-app/index.html`, `notes-app/manifest.webmanifest`, `notes-app/sw.js` (offline cache; bump `VERSION` whenever any cached file changes, and add new files to `CORE`; `CORE` paths are relative to `notes-app/`). `js/app.js` reloads the app once when a new service worker takes over, so an update shows on the first launch after a deploy.
- `js/app.js`: router (`#/today`, `#/classes`, `#/class/<id>/<tab>`, `#/nb/<notebookId>/<pageId>`), Today, Classes, Settings, new-page sheet.
- `js/pagegrid.js`: notebook page grid on the class screen: long-press a page to drag it (ghost + hole, auto-scroll at screen edges), long-press and let go for the page menu (Open, Move to notebook, Delete). Store helpers: `S.reorderPages`, `S.movePageToNotebook` (never leaves a notebook empty).
- `js/editor.js`: page editor, Pencil ink (pointer events, `pointerType === 'pen'` draws, fingers scroll unless Settings > Draw with finger), perfect-freehand strokes, lasso, box Solve (tap Solve, drag a box with Pencil or finger; `enterBoxMode`/`finishBox`), undo/redo, zoom, thumbnails, `solveCtx()` (image + PDF text of a lasso or box for Solve).
- `js/solve.js`: Solve panel (`ctx.onClose` runs when it closes; the editor uses it to remove the Solve box). Order: PDF text layer (no AI, and for a box it wins even if there is ink on top) -> Gemini read of the image (only for handwriting/images) -> Giac engine solves and checks -> answer line formatted for DeltaMath (comma separated, e.g. `5, -1`).
- `js/mathengine.js`: problem normalisation, task detection, Giac commands, answer formatting, interval notation, steps. Pure, testable in Node.
- `js/engine.js` + `js/engine-worker.js`: Giac (GeoGebra WebAssembly build, GPL-3) in a Web Worker. `notes-app/vendor/giac/`.
- `js/gemini.js`: Gemini calls with model hedging (next model starts after 3 s or on 503) and key rotation (on 429). Models default: gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-3.8-flash.
- `js/pdfimport.js`: pdf.js import, stores page text boxes (for Solve without AI) and renders pages to cached JPEGs.
- `js/app.js` Settings also has "Import keys from file" (`parseKeyFile`): reads a .txt, one key per line, merges into IndexedDB settings, shows only the last 4 characters. Never log keys.
- `js/store.js` / `js/db.js`: IndexedDB (classes, notebooks, pages, ink, pdfs, renders, todos, notes, mistakes, meta).
- `js/export.js`: PDF export of a page or notebook (editor More menu, notebook menu, page menu). Own tiny PDF writer, one JPEG per page (1440 px wide, light colours even in dark mode, Letter-size pages at 0.75 pt per page unit). Pages are drawn one at a time and their canvases freed. The share sheet opens from a "PDF ready" sheet because Safari only allows `navigator.share` straight from a tap.
- `js/backup.js`: one-file JSON backup (never includes keys).

## Tests
- Math engine: `node notes-app/test/engine.test.mjs` (must stay 27/27 or better; add cases for anything you change). NOTE: as of Oct 2026 the `notes-app/test/` folder is NOT in the repo (it was never committed). If it is still missing, tell Sam instead of inventing a test suite.
- UI: if Playwright/Chromium is available, serve the repo root (`python3 -m http.server`) and open `http://localhost:8000/notes-app/`; test at 1080x810 (iPad landscape) and 390x844 (iPhone).

## Roadmap
- v1 (done): classes, notebooks, blank/lined/graph/dot pages, PDF import, Pencil writing, lasso, Solve with Giac, Mistakes, backup, light/dark.
- v2 (after Sam confirms his school allows Classroom API access): Classroom announcements + assignments every minute via Apps Script on his school account -> a small free backend -> brief on Today, calendar, notifications.
- v3: practice from Mistakes, NotebookLM Google Docs per unit, iPhone polish.
