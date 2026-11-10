# Wethaq · Academic committee walkthrough

1. Open `/login`. Use a demo email, password `demo`, role **Logistics Planner**. Discuss the academic synthetic-data notice.
2. Show the overview: the five KPI cards, forecast snapshot, inventory risk, status distribution and activity feed. Explain that counts come from shared synthetic state.
3. Open **Demand Forecasting**. Change the part, demand class, location and horizon. Toggle Naive, Croston and synthetic ML candidate overlays. Inspect MAE, MASE and Bias and download CSV. Explain that the ML candidate is an illustration, not a trained XGBoost model.
4. Click **Send to replenishment view**, then open an inventory record. Review modeled stock, assumptions, recommendation and its synthetic stock chart.
5. As Planner, choose **Create simulated shipment request**. Review quantity, forecast month and required note. Confirm. The app navigates to the new shipment in the Shipments page.
6. Use the header role selector to switch to **Dispatcher**, open the shipment and select **Record dispatch**. Watch the five validation checks; confirm the transaction. Switch the eligible Dispatched shipment to **In Transit** in the same way.
7. Change role to **Receiver**, open the shipment and **Confirm receipt**. Enter quantity and a condition note and observe the validation. Note that the condition is informational only.
8. Re-open the shipment timeline. It now shows four stages and **three linked committed transactions** (Dispatch, Status Change, Receipt). The original Requested stage is not a ledger transaction.
9. Open the Ledger tab. Locate each linked transaction and inspect its hash, endorsement presentation, block number, JSON payload and scope notice.
10. Expand **Demonstration tools** on the Shipments tab. Try duplicate receipt, unauthorized organization, invalid status transition, excessive quantity and unknown reference. The operations are rejected, their failed rule is shown, and a rejected attempt appears in Ledger (without a block number).
11. Open Inventory → Alerts, acknowledge a simulated alert, and verify that the count in the header and Overview updates.
12. Switch to **Admin**, open Users & Roles, inspect the permission matrix and demonstrate a mock user or role change.
13. Use the footer's **About this prototype** to reinforce that no real logistics events, physical custody verifications, military data, or automated purchases are involved.

## Quick reset

Use browser developer tools to clear `sessionStorage` for this origin, or open a fresh browser session. Role preference is stored separately in local storage.
