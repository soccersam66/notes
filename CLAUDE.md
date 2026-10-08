# Notes app: guide for Claude Code

Sam's personal class-notes web app for his iPad. Hosted on GitHub Pages at https://soccersam66.github.io/notes/ (deploys from `main`, repo root). Pushing to `main` updates the live app within a couple of minutes.

## Hard rules
- Never use em dashes anywhere (code comments, UI text, commit messages, replies). Use commas, colons, parentheses or plain hyphens. They show up garbled for Sam.
- Never commit API keys, tokens or any secret. This repo is PUBLIC. Gemini keys live only in the app's IndexedDB on the iPad (Settings), never in files.
- Target device: iPad 7th gen (2019, A10, 3 GB RAM) stuck on iPadOS 17, so Safari 17. Apple Pencil 1st gen. Do not use features newer than Safari 17 (no CSS `@scope`, no `Promise.withResolvers` without fallback, no View Transitions API, etc.).
- No build step. Plain ES modules, vanilla JS, no frameworks, no npm runtime deps. Files are served as-is.
- Keep the design: Cal AI-like, minimal, system font, rounded cards, spring animations (cubic-bezier(.2,1.3,.35,1)), light/dark, one accent (black, blue #2F5BEA or green #18794A). CSS tokens are in `css/app.css` `:root`.
- Memory matters on the old iPad: the editor only mounts pages near the viewport (IntersectionObserver). Keep it that way. A past app crashed from too many PDF page images in memory.
- Free tiers only (spending freeze). No paid services.

## Layout
- `index.html`, `manifest.webmanifest`, `sw.js` (offline cache; bump `VERSION` whenever any cached file changes, and add new files to `CORE`).
- `js/app.js`: router (`#/today`, `#/classes`, `#/class/<id>/<tab>`, `#/nb/<notebookId>/<pageId>`), Today, Classes, Settings, new-page sheet.
- `js/editor.js`: page editor, Pencil ink (pointer events, `pointerType === 'pen'` draws, fingers scroll unless Settings > Draw with finger), perfect-freehand strokes, lasso, undo/redo, zoom, thumbnails, `solveCtx()` (image + PDF text of a selection for Solve).
- `js/solve.js`: Solve panel. Order: PDF text layer (no AI) -> Gemini read of the image (only for handwriting/images) -> Giac engine solves and checks -> answer line formatted for DeltaMath (comma separated, e.g. `5, -1`).
- `js/mathengine.js`: problem normalisation, task detection, Giac commands, answer formatting, interval notation, steps. Pure, testable in Node.
- `js/engine.js` + `js/engine-worker.js`: Giac (GeoGebra WebAssembly build, GPL-3) in a Web Worker. `vendor/giac/`.
- `js/gemini.js`: Gemini calls with model hedging (next model starts after 3 s or on 503) and key rotation (on 429). Models default: gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-3.8-flash.
- `js/pdfimport.js`: pdf.js import, stores page text boxes (for Solve without AI) and renders pages to cached JPEGs.
- `js/store.js` / `js/db.js`: IndexedDB (classes, notebooks, pages, ink, pdfs, renders, todos, notes, mistakes, meta).
- `js/backup.js`: one-file JSON backup (never includes keys).

## Tests
- Math engine: `node test/engine.test.mjs` (must stay 27/27 or better; add cases for anything you change).
- UI: if Playwright/Chromium is available, serve the repo (`python3 -m http.server`) and drive it; test at 1080x810 (iPad landscape) and 390x844 (iPhone).

## Roadmap
- v1 (done): classes, notebooks, blank/lined/graph/dot pages, PDF import, Pencil writing, lasso, Solve with Giac, Mistakes, backup, light/dark.
- v2 (after Sam confirms his school allows Classroom API access): Classroom announcements + assignments every minute via Apps Script on his school account -> a small free backend -> brief on Today, calendar, notifications.
- v3: practice from Mistakes, NotebookLM Google Docs per unit, iPhone polish.
