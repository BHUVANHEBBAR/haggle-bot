# Devpost text for HaggleBot (every claim below is true of the code and tests as of Nov 11, 2026)

Fields that must be filled by the owner, not guessed: the hosted URL, the YouTube link, the single sponsor prize chosen, and the hosted seller key (which goes ONLY in Devpost's "testing instructions" field, never in the repository).

## Tagline
An AI haggles for the seller, plain code guards the lowest price, and PayPal collects the payment.

## Short description
HaggleBot lets a small seller put an AI negotiator on their shop. Buyers make offers and get counter-offers; the seller's floor price is enforced by ordinary code the AI never sees, so no prompt can talk it below that line. The agreed price goes through PayPal (Sandbox): checkout, refunds, signed webhooks, and a dashboard that asks PayPal whether the money really arrived.

## What it does
- **Buyer:** chat with the shop's AI, make offers, accept a counter, pay the exact agreed price with PayPal. Or let **their own AI agent haggle for them** with a maximum price they set (enforced in code as well).
- **Seller:** set cost, minimum margin, maximum discount and stock per product; pick a haggler personality (Friendly, Firm, Generous, Playful, Market trader: voice and pace only, never the floor); see every deal's PayPal money trail; add shipment tracking; run a safety check of hundreds of hostile negotiations.
- **Agents:** an open negotiation API (`haggle.v1`) so any buyer's agent can haggle with the shop under the same guardrails.

## How PayPal is central (Sandbox only)
PayPal is the source of truth, not just the last step. Payments run through **Orders v2** (capture, or authorize then capture for services), with **refunds, voids, idempotent requests, and webhooks verified through PayPal's signature API**. The seller console then asks PayPal, by capture ID, whether the money really arrived ("PayPal confirms $41.50 received"), flagging mismatches. Every deal keeps a **money trail** of real PayPal order, capture and refund IDs, `debug_id`s and verified webhook events.

A seller **Copilot** works through PayPal tools (named after PayPal's agent tools) but can only *propose* a refund or capture: PayPal acts only after the seller clicks Confirm, and a test shows a prompt-injected chat transcript cannot trigger a refund.

**PayPal's remote MCP server:** it connects and lists 46 tools. Earlier in the build, tool execution failed on PayPal's side; on Nov 11, 2026 we re-tested and two read-only tools (`list_disputes`, `list_transactions`) ran over MCP through the app's tool layer. Other tools were not exercised, money-moving actions never go through MCP, and the app falls back to the REST API if MCP stops executing. Each Copilot call is labelled `mcp`, `rest` or `local`.

**Invoicing:** creating, sending and cancelling an invoice were run against the real Sandbox. A buyer paying an invoice, and PayPal's real `INVOICING.INVOICE.PAID` payload, were **not** exercised live (covered by the simulated PayPal and tests).

**Shipment tracking:** uses the Orders v2 "add tracking" call; the request is built from PayPal's published spec and tested against a stubbed network and the simulated PayPal. It has **not** been run against the live Sandbox.

Not claimed: Venmo (Sandbox returns no approval link), PayPal's early-access Agentic Commerce services, real-money payments, production-grade buyer authentication (the sign-in code is shown on screen in this demo).

## How we built it
Node.js 20+ with **zero npm dependencies** on the server (`node:test` for tests); React 19, Vite, TypeScript and Tailwind in `web/`, built output committed. AG Grid powers the deals table. AI wording comes from Gemini, Groq or any OpenAI-compatible model, with retries, a circuit breaker and an offline fallback so the demo never stops. The central idea: **the AI proposes, the code decides**: `src/guardrails.js` computes the floor, the concession ladder and every accept/counter/walk-away, and re-checks every reply the AI writes.

AI tools used: Claude Code (development, tests, review), PayPal's developer docs, MCP server and Claude Code plugin (`/paypal:doctor`), and at runtime Gemini and Groq models for the negotiation wording.

## Proof it holds
`npm test` (206 tests, no dependencies, including a sweep showing no offer below the floor is ever accepted), `npm run eval` (500 hostile negotiations and a deliberately hostile AI: 0 violations), 33 browser flows, an off-topic/spam/abuse filter that runs in code before the AI (code questions, gibberish and abuse never reach the model), and an optional AI injection check that can only add flags (measured on a small sample; see the README).

## Challenges
Making a language model sound like five distinct personalities without ever letting it move a price; keeping a free-tier model rate limit from breaking the demo (automatic fallback, labelled); and being exact about what was verified live versus simulated.

## What's next
Verify tracking and invoice payment against the live Sandbox, real buyer authentication, per-seller accounts, and a hosted multi-tenant version.

## Built during the submission period
HaggleBot was started for this hackathon. The public repository's history was condensed before publishing; see the README section "Built during the submission period".

## Sponsor prize (choose ONE; a project can win only one)
To be chosen by the owner: AG Grid (integrated) or Render (deploy). Do not claim both.

## Testing instructions (for the Devpost field)
Fastest: `git clone` the repo, `node src/server.js`, open http://localhost:3000/app/ (no install, no keys; seller password `change-me` locally). Full guide: JUDGES.md. Hosted copy: <hosted URL> (first load can take 30-60 s on the free tier); hosted seller key: <put it here, in the Devpost field only>.
