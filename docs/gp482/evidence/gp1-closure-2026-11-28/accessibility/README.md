# Accessibility check, 28 November 2026

**What was run.** axe-core (through `@axe-core/playwright`, installed temporarily with `--no-save` and not added to the project) against the Demo Mode build. It covered 7 routes (`/login`, `/overview`, `/forecasts`, `/inventory`, `/shipments`, `/users`, and an unknown route) in the light and dark themes, at 1440 px, with reduced motion. The rule tags were `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`. The scan script is in `axe-scan.spec.ts.txt`.

**What this is not.** This is an automated scan. It does not show that the dashboard conforms to WCAG. A manual review with a screen reader and keyboard-only use by real users has not been done (see `UAT_AND_EXPERT_EVALUATION_KIT.md`).

## Findings before and after commit 325d412

| Page (theme) | Before | After |
|---|---|---|
| light /login | color-contrast (1) | color-contrast (1) |
| light /overview | color-contrast (11), heading-order (1), label-content-name-mismatch (1) | color-contrast (11), label-content-name-mismatch (1) |
| light /forecasts | color-contrast (16), heading-order (1), label-content-name-mismatch (1) | color-contrast (16), label-content-name-mismatch (1) |
| light /inventory | color-contrast (62), label-content-name-mismatch (1) | color-contrast (62), label-content-name-mismatch (1) |
| light /shipments | color-contrast (60), label-content-name-mismatch (1) | color-contrast (60), label-content-name-mismatch (1) |
| light /users | color-contrast (5), label-content-name-mismatch (1) | color-contrast (5), label-content-name-mismatch (1) |
| light /does-not-exist | none | none |
| dark /login | none | none |
| dark /overview | color-contrast (7), heading-order (1), label-content-name-mismatch (1) | color-contrast (7), label-content-name-mismatch (1) |
| dark /forecasts | color-contrast (3), heading-order (1), label-content-name-mismatch (1) | color-contrast (3), label-content-name-mismatch (1) |
| dark /inventory | color-contrast (2), label-content-name-mismatch (1) | color-contrast (2), label-content-name-mismatch (1) |
| dark /shipments | color-contrast (27), label-content-name-mismatch (1) | color-contrast (27), label-content-name-mismatch (1) |
| dark /users | color-contrast (2), label-content-name-mismatch (1) | color-contrast (2), label-content-name-mismatch (1) |
| dark /does-not-exist | none | none |

Numbers in brackets are affected elements. The raw results are in `axe-before.json` and `axe-after.json`.

## What was fixed (non-visual)

- **heading-order.** Panel titles were `<h3>` directly under the page `<h1>`. They are now `<h2>`. Every CSS rule for `.panel-heading h3` has a matching `.panel-heading h2` rule, so they look the same. The error state in `LoadGate` now uses an `<h1>`.
- **Checking it looks the same.** 30 full-page screenshots (5 pages × 390/768/1440 px × 2 themes) were compared before and after the change (script in `screenshot-compare.spec.ts.txt`). Three showed tiny differences (at most 24 pixels, at most 8/255 per channel). A second run of the "after" code matched "before" on those three, so the differences are run-to-run anti-aliasing noise.
- **Regression test.** `e2e/workflows.spec.ts` gained "The forecast chart has a table alternative and panel headings sit under the page heading (NFR2)". It runs in all four browser projects.

## What was not changed, and why

- **color-contrast.** The lowest ratios are 2.12:1 (the dark-theme notification count badge, `.bell-count`), 2.26:1 (light Overview mini-table headings) and 2.38:1 (light Forecasts filter headings). WCAG 2.2 AA asks for 4.5:1 for normal text. Fixing them means changing the palette, which the closure brief rules out ("Do not change the visual identity"). This is recorded as a known limitation in `REMAINING_BLOCKERS.md` (B8), with the affected selectors, for the GP2 design pass.
- **label-content-name-mismatch.** One per signed-in page. It is the demo role-switch button, whose accessible name adds the role description to the visible text. axe reports it as "best practice / needs review". The visible text is at the start of the name, so speech input that uses the visible label still works. It was left as it is.

## NFR2 in the GP481 report, checked against this build

NFR2 (Table 4.5) asks for keyboard navigation, visible focus, reduced motion, and a table alternative for the main chart. Keyboard operation is covered by existing tests: `e2e/responsive.spec.ts` checks Escape and that focus returns to the menu button, and `e2e/workflows.spec.ts` opens table rows with Enter. Visible focus is styled with `:focus-visible` in `src/styles.css` and the theme files, but no automated test checks it. Reduced motion is handled with `prefers-reduced-motion` rules in `src/styles.css` (line 35), `dark.css` and `polish.css`. The table alternative is covered by the new test. Colour contrast is not one of the NFR2 criteria, but it is still recorded as a risk.
