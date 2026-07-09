# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server with live reload (http://localhost:5173)
- `npm run build` — builds a single self-contained `dist/index.html` via `vite-plugin-singlefile`
- `npm run preview` — serve the production build locally

There are no tests and no linter.

## What this is

A UK mortgage overpayment simulator: a single-page vanilla JS app with no framework. All markup lives in `index.html`; all logic (simulation, chart, dynamic form rows) lives in `src/main.js`. Chart.js renders the multi-axis graph.

## Architecture notes

- **Everything is reactive to input events.** Every form input (including dynamically added rate fields) has an `input` listener that reruns `runSimulation()`, which recomputes the whole schedule and updates the summary tiles and chart in place.
- **Simulation semantics** (in `runSimulation()` in `src/main.js`): interest rates apply in 2-year fixed periods (`Math.floor(months / 24)` indexes the rate list; the last rate carries forward past the schedule). The minimum payment is recalculated every month from the remaining balance and remaining term. The overpayment is the fixed payment amount minus that minimum, capped at 10% of the balance as it stood at the start of each year.
- **Styling:** Tailwind v4 via `@tailwindcss/vite` (see `vite.config.js`). `src/main.js` imports `src/style.css`, which holds the `@import "tailwindcss"` entry point. There is no `tailwind.config.js` — v4 detects utility classes automatically, including the ones in `main.js` template literals. Everything (Tailwind CSS and Chart.js) is bundled; there are no CDN dependencies, which is what keeps the single-file build offline-capable.
- **`dist/index.html` is committed on purpose** (the portable "precompiled calc"), even though `/dist/` is in `.gitignore` — the file was tracked before the ignore rule, so it still shows as modified after builds. When a change affects the app's behavior, run `npm run build` and commit the updated `dist/index.html` alongside the source.
