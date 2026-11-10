# Wethaq acceptance / review checklist

## Academic boundaries
- [ ] No live military data or real-person credentials anywhere in the UI
- [ ] XGBoost-style synthetic surrogate clearly distinguished from an implemented trained model
- [ ] Ledger simulation not described as deployed Fabric
- [ ] No claim that a recorded receipt proves physical delivery
- [ ] Forecasting data and constructed shipping scenarios labeled independently

## Theme, typography, interaction
- [ ] Switch Light ↔ Dark ↔ System via header and login without layout shift
- [ ] Selected theme persists after refresh, System reacts to OS changes
- [ ] Light and Midnight Navy dark surfaces legible: buttons, popovers, tables, chart labels, drawers, modals, validation results
- [ ] Times New Roman only for headings; Plus Jakarta Sans body/control text; JetBrains Mono ledger refs
- [ ] No decorative full stops at the end of visible headings, help text, banners or alerts
- [ ] Check 390 / 768 / 1024 / 1280 / 1440 widths for clipping/scrolling
- [ ] Keyboard focus, Escape, reduced-motion, accessible names and tab order

## Workflow smoke test
1. Sign in as Planner and record current overview counts
2. Open Guided Demo and follow Forecasts → Inventory
3. Create a request with valid part, location, quantity and note
4. Switch to Dispatcher and dispatch requested shipment
5. Mark In Transit and verify shipment timeline and counts
6. Switch to Receiver and confirm a valid receipt
7. Inspect three linked committed transaction entries
8. Attempt duplicate receipt, invalid transition, unauthorized role, excessive quantity, unknown reference
9. Verify failures create Rejected ATTEMPT entries and alerts, **never new committed blocks**
10. Check role restrictions and Admin-only user changes
11. Test every table search, sort, page, column visibility and CSV export
12. Validate forecast MAE/MASE/bias against synthetic holdout and policy assumptions

## Build gates
- `npm install` to retrieve dependencies
- `npm run check`
- `npm run test`
- `npm run build`
- Review Vercel Preview status and browser console

Local npm installation is not available in the offline authoring container, so the GitHub/Vercel build is the authoritative compile check
