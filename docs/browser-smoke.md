# Local browser smoke suite

Run the real built app in an isolated, installed Chromium browser:

```sh
npm ci --ignore-scripts --offline --no-audit --no-fund
npm test
npm run test:smoke
```

Requirements: Node.js 22+ and an existing Chrome, Chromium or Edge executable. There are **no npm dependencies** and no browser downloads. The lockfile records the empty dependency graph. The `npm ci` step is optional locally; it also verifies that the manifest and lockfile agree.

The suite discovers common browser locations on Windows, macOS and Linux. To select a different existing executable, set `SCANPROOF_BROWSER` or `CHROME_BIN` to its path. A missing executable fails with exit code 1 and an actionable error; tests are never silently skipped. Chrome needs a normal OS sandbox environment. The runner does not disable the browser sandbox or add permissions.

There is no manual server step. The runner builds `dist/`, starts a GET/HEAD-only server on a free `127.0.0.1` port, launches a headless browser with an owned temporary profile, and creates a fresh browser context for each viewport. Fixtures, draft data and downloads belong only to this run. The suite does not navigate to the live demo, reuse a personal profile, upload files or touch a user's existing draft. It closes its own browser/server and verifies that the seven production assets have not changed.

## Assertions

Each run performs 17 named checks in both desktop (1440×1000) and touch/mobile emulation (390×844):

- Empty startup, disabled export and a visible error for blank task input.
- Atomic rejection of a valid + corrupt image batch, followed by real JPG/PNG/WebP input, decoded thumbnails and exact file names.
- Exact manual checklist result `3 / 3`, with one task linked to two pages.
- Enter selection, Space checkbox changes, Tab order and repeated keyboard reorder without losing focus.
- `C,A,B` order, C rotated 90°, loss of task coverage when A is deleted, and undo restoring the same page IDs and links.
- A real browser PDF download, with three pages, expected image order/orientation, A4 boxes and valid image placement.
- Negative controls: the PDF checker must reject swapped expected pages and a truncated download.
- Rename via Enter preserves the task ID, both page links and coverage; empty/duplicate names show errors; Escape and Cancel discard edits.
- Renaming checklist text leaves exported PDF bytes unchanged; view-only navigation retains the current PDF and human confirmation.
- Reload restores the last viewed page, renamed labels and all links. **Human confirmation and the PDF result reset.** The test confirms again and downloads a newly created PDF.
- Reimporting the same bytes under another name produces an exact-duplicate warning, without changing existing mappings.
- The editor fits the viewport; Tab and Escape work at 390 px.
- No uncaught page exceptions, failed asset responses, external app requests or mutating network requests.

Image fixtures are generated synthetic sheets, independently of the app's image/PDF modules. Expected rotated JPEGs are prepared directly with Canvas from the original fixtures. The downloaded PDF is read in Node: xref offsets, stream lengths, page count, image JPEG hashes/dimensions, A4 orientation, centered placement and aspect ratio are asserted. Expectations are generated per run, so browser font/encoder differences do not require a platform-specific golden file.

## Results and failure diagnosis

Exit code 0 means every check and teardown passed. Any assertion, browser setup or cleanup failure returns 1. Standard output names the profile and failing step. Retained evidence is under ignored `artifacts/smoke/run-*/`:

- `report.json`: actual steps, timings, browser/Node version, requests, PDF hashes and cleanup status.
- `desktop/success.png` and `mobile-390/success.png`: real page screenshots after a successful profile.
- Three actual PDFs per profile: before rename, after rename and after reload, plus raw browser downloads and synthetic inputs.
- `failure.png` and UI details in the report if a page-level failure occurs. Setup failures before a page exists have no screenshot.

Each run uses a new output folder, port and browser profile; it can be repeated without deleting earlier evidence. A browser that fails before launch needs no profile cleanup (`profileCleaned` is false in that setup report); `serverClosed` still records server teardown. Evidence is local and is not part of `dist/` or the published repository.

## Future CI and limits

On a runner that already has Chrome/Chromium installed, the same `npm run test:smoke` command is the proposed CI step after unit tests. An explicitly supplied executable is preferable for a pinned runner image. No workflow, permissions, secrets or publication settings are changed by this suite. The local result does not claim that a GitHub Actions browser run has passed.

This is a bounded smoke suite, not a full replacement for manual QA:

- Chromium only. The 390 px profile is emulation with keyboard/touch events, not a physical phone, Safari or Firefox.
- File selection uses the browser's CDP file-input API; the native OS picker/cancel dialog and drag/drop are not exercised.
- PDF validation is structural and checks actual embedded raster bytes/placement; it is not a full independent PDF renderer or a human readability assessment.
- Unit tests separately cover byte/pixel limits, file headers, blank-page heuristics, draft corruption and repeated/overlong renames. Browser smoke does not cover storage quota failures, multiple-tab contention or every boundary value.
- PDF/HEIC import, OCR, PWA/offline operation and submission to an LMS are unsupported features, not skipped smoke successes.
