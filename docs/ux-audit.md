# UX audit (screenshot-based) and what changed

Method: judge from screenshots, not code (`scripts/e2e/audit-shots.js`: 17 screens x 375 / 768 / 1280 px, light and dark, 85 images), then score each screen on primary action, hierarchy, touch targets, contrast, focus, loading / empty / error states, copy, token use and responsive behaviour. Ideas on method came from the public "ui-ux-designer" and "ui-visual-validator" skill descriptions in rmyndharis/antigravity-skills (read as reference only; nothing from that repo is installed or run).
Machine checks stay in place: `scripts/e2e/a11y.js` (axe, light and dark, every page and seller tab) and the 375px overflow flow.

| # | Screen | Observed | Severity | Fix |
|---|---|---|---|---|
| 1 | Seller > Deals at 375px | Only Product and Price columns fit; Refund, Invoice and Details buttons were off screen, so the main money actions were unreachable on a phone | Should fix | Phones get a card list (same actions, wrapping); desktop keeps the AG Grid |
| 2 | Shop header at 375px | The theme toggle wrapped onto a second row alone, making the header tall | Should fix | First attempt (grouping the buttons) did **not** fit one row; the new browser flow z3 caught it. Fixed by making Sign in / Sign out icon-only below 640px (accessible names kept) |
| 3 | Order page, paid | Step 3 "Seller ships" looked finished although it had not happened; the green banner repeated the headline | Should fix | Steps now show done (check) / current (heavy border) / later; banner trimmed to the receipt line |
| 4 | Seller overview | 8 stat tiles laid out 5 + 3 with a gap; page title stacked above a separate Sign out button | Polish | 4 x 2 grid (2 across on phones); title and Sign out on one row |
| 5 | Shop cards | Price row and buttons sat at different heights across cards because only some have a quantity control | Polish | Fixed minimum height for the price row |
| 6 | Seller > Pricing at 375px | Rules table scrolls sideways with no hint | Polish | "Swipe sideways" hint and a focusable, labelled scroll region |
| 7 | Console header | Seller console header carried the shop's badges and nav on mobile | Polish | Own compact header, link on its own row |

Checked and found fine: shop hierarchy and trust strip (1280 and 375), sign-in dialog (both steps), My orders empty and filled, 404, seller sign-in, dark theme parity, no horizontal overflow on any screen or width.
Not an issue: in full-page screenshots of the chat the sticky header appears mid-page; that is a capture artefact of the sticky bar.

Each row above now has a browser assertion (flows z1-z5 in `scripts/e2e/run.js`): phone deals cards, order steps, one-row header, tab keyboard navigation, sign-in error paths.

Open items (not done): real-device pass on iOS Safari; a first-run tour for buyers; shipment tracking.
