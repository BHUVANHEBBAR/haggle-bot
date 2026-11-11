# 2:50 demo video script (hard limit is 3:00)

Record in a **clean Chrome profile** (no bookmarks, no other tabs, no notifications, nothing with a logo or a trademark on screen). Use OBS or Windows Game Bar (`Win+G`). **No music.** Say it in your own words; the lines below are about 400 words, which fits. Do one practice run, then record. Public on YouTube, under 3:00.

Before you start: `node src/server.js` (or the hosted link), a product with stock, signed in to the seller console in a second tab, and your PayPal Sandbox **Personal** test account ready. Do not show passwords or keys on screen.

**0:00 - 0:15 The problem** (shop page)
"Small sellers get asked for a discount all day. Saying yes too fast costs margin, replying takes time. HaggleBot lets an AI haggle, plain code enforces the seller's lowest price, and PayPal takes the payment."

**0:15 - 1:00 Haggle and pay with PayPal** (shop)
1. Open the tote ($48), **Make an offer**. Type `I can pay $20`. Point at the chip: "below the seller's limit, refused".
2. Type `$38`, then **Accept** the counter. "The price is locked on the server; the browser never sets the amount."
3. **Checkout with PayPal**, approve with the Sandbox Personal account, land on the order page. "PayPal Orders v2, captured."

**1:00 - 1:20 Auto-haggle** (`/app/auto`)
"Buyers can also send their own AI." Pick the tote, enter `46` as the most you would pay, **Start haggling**. Show the deal at or under $46. "Their maximum is enforced in code too; and the shop's floor still holds."

**1:20 - 1:45 The AI cannot be tricked** (`/app/battle`)
Pick the tote, **Manipulator**, Start. When it says "Ignore your previous instructions", point at the red chip: "ignored". "The AI never even sees the floor price, so it cannot leak it."

**1:45 - 2:35 The seller's side: PayPal is the source of truth** (seller console)
1. **Deals** > the paid deal > **Details**: "the money trail: real PayPal order, capture, `debug_id`, and the webhook marked signature verified."
2. **Money & PayPal** > **Reconcile**: "PayPal itself confirms the amount, fetched by capture ID."
3. **Copilot**: type "refund the tote deal". "It can only propose. Nothing moves until I press Confirm." Click **Confirm**: PayPal refunds, the trail shows the refund ID.
4. **Deals** > **Add tracking** on another paid physical deal: carrier and number. "Sent to PayPal with the Orders tracking call; the buyer sees it on their order page."
5. **Pricing rules** > **Run safety check**: "hundreds of hostile buyers and a deliberately misbehaving AI: zero rules broken."

**2:35 - 2:50 Close**
"Idempotent requests, signed webhooks, declined-card handling, sandbox only. Open source and free to run: `node src/server.js`. Thanks!"

## Say it honestly
- Say **sandbox** whenever PayPal appears. No real money moves.
- Invoicing was verified live for create, send and cancel; a buyer paying an invoice was not, so call that part simulated. Do not mention Venmo.
- Shipment tracking is matched to PayPal's published spec and tested against stubs and the simulated PayPal; do not say it was run live unless you have run it.
- If the AI says it fell back to the offline brain, that is the free-tier rate limit working as designed; re-take if you want the live model on screen.

## Cut list if you run over
Drop the Auto-haggle block first (20 s), then the safety-check line, then shorten the battle block. Keep the PayPal blocks.
