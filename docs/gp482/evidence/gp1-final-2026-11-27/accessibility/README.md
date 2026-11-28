# Automated accessibility check (axe-core), 2026-11-27

**Scope.** Automated checks only. They find some WCAG failures; they cannot show that the dashboard conforms
to WCAG 2.2 AA. No manual screen-reader, keyboard-only or user testing with people with disabilities was done in
GP1, so no claim of full accessibility compliance is made.

**Method.** `@axe-core/playwright` 4.14.1 (axe-core 4.14.1), installed for this run only (not added to the
project), rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`. Chromium,
1440 × 900, Demo Mode (`npm run dev`), signed in as the default demonstration role (Logistics Planner), light and
dark colour schemes. Pages: `/login`, `/overview`, `/forecasts`, `/inventory`, `/shipments`, `/users` (shows
*Access restricted* for that role), and an unknown address (the 404 page). The script is `a11y.spec.ts.txt`;
the full results after the fixes are in `axe-after.json`.

## Violations before and after

Rule (impact): number of elements, light / dark.

| Page | Before | After |
| --- | --- | --- |
| `/login` | color-contrast 1 / 0, landmark-one-main 1 / 1, region 11 / 11 | color-contrast 1 / 0 |
| `/overview` | color-contrast 11 / 7, heading-order 1 / 1, label-content-name-mismatch 2 / 2, svg-img-alt 4 / 4 | color-contrast 11 / 7, heading-order 1 / 1, label-content-name-mismatch 1 / 1 |
| `/forecasts` | color-contrast 16 / 3, heading-order 1 / 1, label-content-name-mismatch 2 / 2 | color-contrast 16 / 3, heading-order 1 / 1, label-content-name-mismatch 1 / 1 |
| `/inventory` | color-contrast 62 / 2, label-content-name-mismatch 2 / 2 | color-contrast 62 / 2, label-content-name-mismatch 1 / 1 |
| `/shipments` | color-contrast 60 / 27, label-content-name-mismatch 2 / 2 | color-contrast 60 / 27, label-content-name-mismatch 1 / 1 |
| `/users` (restricted) | color-contrast 5 / 2, label-content-name-mismatch 2 / 2, page-has-heading-one 1 / 1 | color-contrast 5 / 2, label-content-name-mismatch 1 / 1 |
| 404 page | landmark-one-main 1 / 1, page-has-heading-one 1 / 1, region 1 / 1 | none |

## Fixed (no visual change)

| Issue | Fix |
| --- | --- |
| Sign-in page and 404 page had no main landmark, so their content was outside any landmark | `role="main"` on the page container (`Login.tsx`, `App.tsx`) |
| *Access restricted* and *Page not found* had no level-one heading | `h2` → `h1`; `.state-page h1` given the same size, line height, colour and margins as before (`styles.css`) |
| Donut chart sectors (`role="img"` set by Recharts) had no text alternative | each sector is labelled with its status and count (`Charts.tsx`); the chart already had an overall label |
| *Guided demo* button's accessible name did not contain its visible text (WCAG 2.5.3) | name changed from "Start guided demonstration" to "Start guided demo" (`GuidedDemo.tsx`) |

Full-page screenshots of the sign-in, overview, restricted and 404 pages in both colour schemes were compared
before and after these changes: all eight are pixel-identical.

## Not changed, documented

* **Colour contrast (serious).** Mostly small secondary text and labels: for example `#668196` on `#0F2A44`
  (3.58:1) for the sidebar year, white on `#8A9A4B` (3.08:1) for the notification count, `#81915B` on
  `#F7F8FA` (3.22:1) for eyebrow labels, `#A2AEB6` on white (2.26:1) for small table headings. Fixing them
  means changing the colour palette, which the brief forbids for GP1 (visual identity). Recommended for GP2 with
  the designers: darken the secondary text tokens until they reach 4.5:1.
* **Heading order (moderate).** On Overview and Forecasts the first panel heading is an `h3` directly under the
  page's `h1`. Changing panel headings to `h2` touches several style rules across the theme files; left for GP2.
* **Demo role button, label in name (serious, reviewed).** The accessible name "Demo role: Logistics Planner"
  contains both visible words ("DEMO ROLE", "Logistics Planner"). axe still flags it because it counts the
  decorative avatar initial (marked `aria-hidden`) as visible text. A minimal test page confirmed this: the same
  button passes without the initial. The end-to-end tests also depend on this name. Not changed.
