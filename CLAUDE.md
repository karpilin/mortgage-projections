# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server with live reload (http://localhost:5173)
- `npm run build` — builds a single self-contained `dist/index.html` via `vite-plugin-singlefile`
- `npm run preview` — serve the production build locally
- `npm test` — run the Vitest suite (`vitest run`); use `npx vitest` for watch mode

There is no linter.

## What this is

A UK mortgage overpayment simulator: a single-page vanilla JS app with no framework. Its purpose is to highlight the benefits of *payment reduction* over *term reduction* when overpaying — a falling contractual minimum gives flexibility against income/rate changes for slightly more interest — so `reducePayment` is the default mode and the UI compares the two modes head-on. Don't reframe the tool around fastest payoff. All markup lives in `index.html`; the simulation is a pure module in `src/simulation.js` (unit-tested in `src/simulation.test.js`); `src/main.js` handles DOM, validation, and the Chart.js multi-axis graph.

## Architecture notes

- **Everything is reactive to input events.** Every form input (including dynamically added rate fields) has an `input`/`change` listener that reruns `runSimulation()`, which recomputes the whole schedule and updates the summary tiles and chart in place.
- **Simulation semantics** (`simulate()` in `src/simulation.js`): interest rates apply in 2-year fixed periods (the last rate carries forward past the schedule). The lender's *contractual payment* stays fixed within each period and is recalculated only at rate changes; how it's recalculated depends on the overpayment mode — `reduceTerm` keeps the payment level so overpayments shorten the loan (via `impliedRemainingTerm`), `reducePayment` re-amortizes to the original end date. The overpayment is the user's fixed payment minus the contractual payment, capped at 10% of the balance as it stood at the start of each year; payments below the contractual payment are raised to it and flagged. The final payment is clamped so the balance lands on exactly zero.
- **Keep `simulate()` pure.** It must stay DOM-free so the test suite (invariants like money conservation, cap ceiling, no negative balance) keeps working; UI concerns belong in `main.js`.
- **Styling:** Tailwind v4 via `@tailwindcss/vite` (see `vite.config.js`). `src/main.js` imports `src/style.css`, which holds the `@import "tailwindcss"` entry point. There is no `tailwind.config.js` — v4 detects utility classes automatically, including the ones in `main.js` template literals. Everything (Tailwind CSS and Chart.js) is bundled; there are no CDN dependencies, which is what keeps the single-file build offline-capable.
- **`dist/index.html` is committed on purpose** (the portable "precompiled calc"), even though `/dist/` is in `.gitignore` — the file was tracked before the ignore rule, so it still shows as modified after builds. When a change affects the app's behavior, run `npm run build` and commit the updated `dist/index.html` alongside the source.
