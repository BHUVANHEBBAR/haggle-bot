# Judges' guide: run HaggleBot in under 2 minutes

You do not need an account, an API key or `npm install`. HaggleBot ships with a **demo mode** (simulated PayPal and an offline AI) that exercises the same code paths as the real thing, and an optional **real PayPal Sandbox** mode.

| I want to... | Do this | Time |
|---|---|---|
| Try it with nothing to set up | [Run locally in demo mode](#1-run-it-locally-no-setup) | 1 min |
| Try the hosted copy | [Hosted copy](#2-hosted-copy) | 1 min |
| See it use my own PayPal Sandbox | [Real PayPal Sandbox](#4-optional-use-your-own-paypal-sandbox) | 5 min |
| Check the claims | [Verify](#5-verify-the-claims) | 1 min |

## 1. Run it locally (no setup)

Needs **Node.js 20 or newer** (`node -v`). Nothing to install: the server uses only Node built-ins and the built frontend is committed.

```bash
git clone https://github.com/BHUVANHEBBAR/haggle-bot.git
cd haggle-bot
node src/server.js
```

Open **http://localhost:3000/app/**. The terminal prints `AI brain : mock` and `PayPal   : simulated` - that is demo mode.

Seller console password locally: **`change-me`** (it is only a demo default; the server refuses to start with it on a public host).

## 2. Hosted copy

Live demo: **see the link in the Devpost submission** (and the repository's website field). The free host sleeps when idle, so the **first load can take 30-60 seconds**; then it is fast.

The hosted copy uses PayPal **Sandbox** credentials and a real AI model. Its seller key is given only in the Devpost "testing instructions" field (it is never stored in this repository). If the hosted copy is slow or asleep, use the local run above: it behaves the same.

## 3. A 3-minute tour

1. **Haggle** (`/app/`): open the *Handwoven Block-Print Tote* ($48.00) and press **Make an offer**. Type `I can pay $20`. The assistant refuses and a chip says the offer was below the seller's limit. Try `$30`, then `$38`: you get counter-offers. Press **Accept** on one.
2. **Pay with PayPal**: press **Checkout with PayPal**. In demo mode a simulated PayPal page opens (with a "simulate a declined card" button); approve it. You land on the **order page** showing the agreed price and order progress. With real Sandbox credentials this is PayPal's own page.
3. **Seller console** (`/app/seller`): sign in with the seller key. **Overview** shows the live feed and charts. **Deals** shows your deal; press **Details** for the *money trail* (order, capture, webhook "signature verified").
4. **PayPal is the source of truth**: **Money & PayPal** > **Reconcile with PayPal** fetches each payment by its ID and compares it with the record ("PayPal confirms $... received"). The **Copilot** can *propose* a refund; nothing moves until you press **Confirm**.
5. **Pricing rules**: change a product's cost or margin and watch the **floor** (the lowest price the AI may ever accept) move in the **rule playground**. Pick a **Haggler personality** (try the tote: the asking prices by round are shown on each card). Press **Run safety check**: hundreds of hostile buyers and a deliberately misbehaving AI, zero rules broken.
6. **Agent vs agent** (`/app/battle`): choose the tote, the **Manipulator** buyer, start. It tries prompt injection and to fish for the floor price; red chips show the attempts being ignored and the deal closes above the floor.

The idea in one line: **the AI proposes, plain code decides.** The AI never sees the floor price, and the price sent to PayPal comes from the stored deal, never from the browser.

## 4. (Optional) Use your own PayPal Sandbox

1. At [developer.paypal.com](https://developer.paypal.com) > Apps & Credentials > **Sandbox**, create an app and copy its **Client ID** and **Secret**.
2. `cp .env.example .env` and set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Optionally set `SELLER_KEY` (your console password) and one AI key (`GEMINI_API_KEY` or `GROQ_API_KEY`; free tiers exist). `.env` is git-ignored.
3. `node src/server.js` again. The terminal now prints `PayPal   : SANDBOX (live API calls)`. Pay with one of your Sandbox **Personal** test accounts. You can see the payment under your Sandbox Business account on sandbox.paypal.com.
4. Webhooks need a public URL (PayPal cannot reach `localhost`): see "Register the webhook" in the README. Without it, payments still complete through the return flow.

The app talks only to `api-m.sandbox.paypal.com` and **refuses to start** with any other PayPal environment. Never put real credentials in a repository.

## 5. Verify the claims

```bash
npm test         # 206 tests, no dependencies (node:test)
npm run eval     # 500 hostile negotiations: expect "PASS: 0 violations"
npm run voice    # optional, needs a live AI key: prints each personality's replies
```

- `npm test` includes a sweep proving no offer below the floor is ever accepted, prompt-injection tests, the full PayPal flow against the simulated PayPal, declined-card retry, authorize/capture/void, refunds, webhook idempotency and forged-webhook rejection.
- `npm run eval` attacks the real pipeline with hostile buyers and a hostile AI and checks, independently of the production code, that no deal is below the floor and nothing leaks.

## What is real and what is simulated

| Piece | Demo mode (no keys) | With your Sandbox keys |
|---|---|---|
| PayPal Orders, capture, authorize, void, refund | Simulated, same interface and same code paths | **Real PayPal Sandbox API** |
| Webhook signature check | Simulated events through the real verification code | Real PayPal webhooks (needs a public URL) |
| Reconcile / money trail | Against the simulated PayPal | Against PayPal by capture ID |
| Invoicing | Simulated | Create / send / cancel verified live; a buyer paying an invoice was **not** verified live |
| PayPal remote MCP server | Not used | Connects and lists 46 tools. Tool execution failed on PayPal's side earlier in the build; on Nov 11, 2026 two read-only tools (`list_disputes`, `list_transactions`) ran over MCP. The app falls back to REST if MCP stops executing and labels which transport served each call |
| AI wording | Offline scripted brain | Gemini, Groq or any OpenAI-compatible model, with automatic fallback |
| Money | None | Sandbox money only |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` / port already used | `PORT=3001 node src/server.js` (then open that port) |
| `node: command not found` or syntax errors | Install Node.js 20+ from nodejs.org |
| Blank page at `/` | Open `/app/`; the built frontend is in `public/app/` (no build needed) |
| "Wrong seller key" | Locally the key is `change-me` unless you set `SELLER_KEY` in `.env`; after five wrong tries the login is locked for a few minutes |
| Hosted copy is slow the first time | Free tier cold start (30-60 s). Reload once |
| AI says it fell back / rate limited | Expected on free tiers: the app retries, tries another provider, then the offline brain; the reply is labelled with the brain that answered |
| "Refusing to start: SELLER_KEY ..." | You are on a public host with the default key. Set your own `SELLER_KEY` |
| No webhook events locally | Needs a public URL; demo mode exercises the same verification code |

## Security notes for judges

- Sandbox only. No real payments, no real card data.
- No secrets in this repository: keys live in `.env` (git-ignored) or the host's dashboard. The full history was scanned for key patterns before submission.
- The seller's floor price is enforced in code (`src/guardrails.js`); the AI cannot lower it, and replies are re-checked before a buyer sees them.
- Buyer sign-in is a **demo** (the one-time code is shown on screen); see "Honest limitations" in the README.

More detail: [README](README.md) | [Demo video script](DEMO_SCRIPT.md) | [Security](SECURITY.md)
