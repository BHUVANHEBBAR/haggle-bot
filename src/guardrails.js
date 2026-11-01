'use strict';
/**
 * GUARDRAILS: the seller's rules, enforced in plain code.
 * The AI never sees the floor price and cannot override anything in this file.
 * The AI may only *propose* a price inside the range this module allows.
 */
const { usd } = require('./money');

const MAX_ROUNDS = 6;                       // buyer offers before the seller walks away
const PROGRESS = [0.30, 0.55, 0.75, 0.90, 1.0, 1.0]; // share of the (list - floor) gap conceded per round

/** Lowest unit price (cents) the seller will ever accept. Seller-private. */
function effectiveFloorCents(p, qty = 1) {
  const list = p.listCents;
  const marginFloor = Math.ceil(p.costCents * (1 + p.minMarginPct / 100));
  let floor = Math.max(marginFloor, Math.ceil(list * (1 - p.maxDiscountPct / 100)));
  if (p.stock <= p.lowStockThreshold) {
    floor = Math.max(floor, Math.ceil(list * (1 - p.lowStockMaxDiscountPct / 100)));
  }
  if (p.bulkQty && qty >= p.bulkQty && p.bulkExtraDiscountPct > 0) {
    floor = Math.max(marginFloor, Math.ceil(floor * (1 - p.bulkExtraDiscountPct / 100)));
  }
  return Math.min(floor, list);
}

/** The ask the seller's concession schedule reaches at a given round (1-based). */
function ladderCents(p, qty, round) {
  const floor = effectiveFloorCents(p, qty);
  const prog = PROGRESS[Math.min(Math.max(round, 1), PROGRESS.length) - 1];
  return p.listCents - Math.round((p.listCents - floor) * prog);
}

const niceUp = (c) => Math.ceil(c / 50) * 50; // round counters up to the next 50 cents

/** The counter-offer the seller makes at a given round (same maths decide() uses). */
function counterCents(p, qty, round) {
  const floor = effectiveFloorCents(p, qty);
  return Math.min(Math.max(niceUp(ladderCents(p, qty, round)), floor), p.listCents);
}

/**
 * Decide what to do with a buyer message. Pure function, no AI involved.
 * offerCents: buyer's offered unit price or null; round: count of offers incl. this one.
 */
function decide({ product, qty = 1, round, offerCents, askCents }) {
  const floor = effectiveFloorCents(product, qty);
  // The ask can never sit below the floor in force NOW: if the seller tightened their rules mid-chat,
  // an older, lower counter must not be honoured (it would close a deal below the new floor).
  const ask = Math.max(floor, Math.min(askCents ?? product.listCents, product.listCents));
  if (offerCents == null) return { action: 'chat', priceCents: ask };

  if (offerCents >= ask) return { action: 'accept', priceCents: ask };
  const ladder = ladderCents(product, qty, round);
  if (offerCents >= ladder && offerCents >= floor) return { action: 'accept', priceCents: offerCents };
  if (round >= MAX_ROUNDS) return { action: 'walk_away', priceCents: ask };

  const minCounter = Math.min(Math.max(niceUp(ladder), floor), ask);
  return {
    action: 'counter',
    priceCents: minCounter,
    minCents: minCounter,   // the AI may be tougher than the schedule, never softer
    maxCents: ask,          // and may never raise the price above the previous ask
    final: round >= 5,
    belowFloor: offerCents < floor,
  };
}

/** Force any AI-proposed price into the allowed range. Returns the safe price. */
function enforcePrice(decision, proposedCents, product, qty = 1) {
  const floor = effectiveFloorCents(product, qty);
  if (decision.action !== 'counter') return { priceCents: decision.priceCents, clamped: false };
  let p = Number.isFinite(proposedCents) ? Math.round(proposedCents) : decision.priceCents;
  const before = p;
  p = Math.min(Math.max(p, decision.minCents), decision.maxCents);
  p = Math.max(p, floor); // belt and braces: the floor is absolute
  return { priceCents: p, clamped: p !== before, proposedCents: before };
}

// ---------- reading the buyer's message ----------
const MONEY = /(?:(?:\$|usd|us\$)\s*(\d{1,6}(?:[.,]\d{1,2})?))|(?:(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:\$|usd|dollars?|bucks))/gi;
const BARE = /\b(\d{1,6}(?:\.\d{1,2})?)\b/;
const OFFER_WORDS = /\b(offer|pay|take|give|do|for|at|how about|can you|meet|go|settle|best)\b/i;
const ACCEPT_WORDS = /\b(deal|i'?ll take it|i will take it|i accept|accepted|sold|works for me|let'?s do it|okay,? i'?ll buy)\b/i;

/** Pull an offered unit price (cents) out of free text. Returns null if there isn't one. */
function extractOffer(text, askCents) {
  const t = String(text || '');
  const amounts = [];
  let m;
  MONEY.lastIndex = 0;
  while ((m = MONEY.exec(t))) amounts.push(Number((m[1] || m[2]).replace(',', '.')));
  if (!amounts.length && (t.length <= 28 || OFFER_WORDS.test(t))) {
    const b = t.match(BARE);
    if (b) amounts.push(Number(b[1]));
  }
  if (amounts.length) {
    const cents = Math.round(amounts[amounts.length - 1] * 100);
    return cents > 0 ? cents : null;
  }
  if (askCents != null && ACCEPT_WORDS.test(t)) return askCents; // "deal" = accept the current ask
  return null;
}

// ---------- prompt-injection / secret-fishing detection ----------
const INJECTION_PATTERNS = [
  /ignore (all |your |any )?(previous|prior|above|earlier)? ?(instructions|rules|prompt)/i,
  /disregard (the |your |all )?(rules|instructions|system)/i,
  /(system|developer|admin) (prompt|mode|message|override)/i,
  /you are now\b/i,
  /\b(jailbreak|dan mode|debug mode)\b/i,
  /(reveal|tell me|show|what'?s|what is) (me )?(your |the )?(minimum|lowest|floor|cost|reserve|bottom)( price| margin)?/i,
  /(minimum|lowest|floor|reserve|cost) price\b/i,
  /\bpretend (that )?(you|the)\b/i,
  /\bsell (it )?(to me )?for \$?0*1\b/i,
];
function detectInjection(text) {
  const t = String(text || '');
  return INJECTION_PATTERNS.some((re) => re.test(t));
}

// ---------- checking what the AI wrote before the buyer sees it ----------
const LEAKY_WORDS = /\b(floor|reserve price|cost price|my cost|profit margin|margin|wholesale|system prompt|instructions)\b/i;
function sanitizeReply(text, allowedCents) {
  if (typeof text !== 'string') return null;
  const t = text.trim().slice(0, 600);
  if (!t) return null;
  if (LEAKY_WORDS.test(t)) return null;
  const allowed = new Set(allowedCents.filter((c) => Number.isFinite(c)));
  MONEY.lastIndex = 0;
  let m;
  while ((m = MONEY.exec(t))) {
    const c = Math.round(Number((m[1] || m[2]).replace(',', '.')) * 100);
    if (!allowed.has(c)) return null;
  }
  return t;
}

module.exports = {
  MAX_ROUNDS, effectiveFloorCents, ladderCents, counterCents, decide, enforcePrice,
  extractOffer, detectInjection, sanitizeReply, usd,
};
