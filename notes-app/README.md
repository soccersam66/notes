# Notes

Class notebooks for the iPad with Apple Pencil, and a Solve button that answers math problems with a real math engine.

Your notes stay on your iPad (in the browser's storage). Nothing is uploaded anywhere. Use Settings > Back up to save a copy.

## Put it online (GitHub Pages, free) - do this on the PC

1. Make a free account at github.com (if you don't have one).
2. Top right **+** > **New repository**. Name: `notes`. Public. Click **Create repository**.
3. On the new repo page click **uploading an existing file**.
4. Unzip `notes-app.zip`. Open the `notes-app` folder, select everything inside it (index.html, css, js, vendor, icons, and the rest) and drag it all onto the GitHub page. Wait for every file to finish, then **Commit changes**.
5. Repo **Settings** > **Pages** > Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)** > **Save**.
6. Wait 1 to 2 minutes. Your app is at `https://YOUR-USERNAME.github.io/notes/`.

## Put it on the iPad

1. Open that link in **Safari** on the iPad.
2. Share button > **Add to Home Screen** > Add.
3. Open it from the Home Screen. The first open downloads the math engine (about 10 MB, once). After that it works offline.
4. Settings (gear) > paste your Gemini keys (one per line) so Solve can read handwriting. Printed problems from PDFs work without any keys.

## Updating later

Upload the changed files to the same repo (they replace the old ones). The app picks up the new version the next time it is opened twice.

## What is in it (v1)

- Today: greeting, school-day streak (weekends never break it, one free miss per week), continue where you left off, to-do list, quick notes.
- Classes: any number of classes, notebooks inside each, new blank pages anywhere (blank, lined, graph, dot), PDF import (teacher slides from the Google Drive app in Files).
- Writing: Pencil only (palm and fingers scroll), pen, highlighter, eraser, lasso (move, recolor, delete, Solve), undo and redo, pinch or buttons to zoom.
- Solve: reads printed PDF text directly (no AI), or reads handwriting with one quick Gemini call that switches to a backup model if the first is busy; then the Giac math engine solves it exactly, checks the answer, and gives a DeltaMath-style answer line plus steps.
- Mistakes list per class, backup and restore, light and dark mode, black, blue or green accent.

## Licenses

- Math engine: Giac (GeoGebra WebAssembly build), GPL-3.0. Source: https://github.com/geogebra/giac
- pdf.js (Mozilla), Apache-2.0.
- perfect-freehand (Steve Ruiz), MIT.
- This app is released under GPL-3.0 (see LICENSE) because it includes Giac.
