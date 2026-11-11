'use strict';
/**
 * Topic gate for the haggle chat. Plain code, no AI: it decides what the shop assistant is willing to talk about.
 *
 *   classify(text, product, askCents) -> { kind, text, offerCents? }
 *
 *   kind 'offer'     a price (or "deal") was found; `text` is what the AI may see (junk around a clear price is dropped)
 *   kind 'on_topic'  about the product, its price, shipping, the purchase, or a plain greeting
 *   kind 'code' | 'abuse' | 'gibberish' | 'off_topic' | 'foreign' | 'empty'   never sent to the AI, never advances the negotiation
 *
 * Order matters: code is checked BEFORE offers are parsed, so "write python for 5" can never become a $5 offer.
 * The vocabulary is deliberately plain and readable. English only; borderline questions get a polite redirect and the buyer can rephrase.
 */
const g = require('./guardrails');

const STRIKES_TO_END = 4; // consecutive refused messages before the chat is closed (a new chat can start at once)

// ---------- code and programming ----------
const CODE_PATTERNS = [
  /```|~~~/,
  /\b(def|function|class|interface|struct|enum)\s+\w+\s*[({:<]/i,
  /\bimport\s+[\w.]+(\s+as\s+\w+)?\s*(;|$)/im,
  /\bfrom\s+[\w.]+\s+import\b/i,
  /\brequire\s*\(\s*['"]/,
  /\b(console\.log|printf|println|System\.out|document\.getElementById)\b/i,
  /\bprint\s*\(/i,
  /=>|\+\+;|;\s*$|\)\s*\{|\}\s*else\b/m,
  /\bfor\s*\(.*;.*;.*\)/,
  /\bfor\s+\w+\s+in\s+(range|enumerate|\w+\s*[:(\[])/i,
  /\bselect\s+[\w*, ]+\s+from\s+\w+/i,
  /\b(insert\s+into|drop\s+table|delete\s+from|update\s+\w+\s+set)\b/i,
  /<\/?(script|html|div|body|span|img|iframe|style)\b/i,
  /#include\s*</,
  /\bpublic\s+static\s+void\b/,
  /\b(sudo|chmod|curl|wget|npm\s+(install|run)|pip3?\s+install|git\s+(clone|commit|push|pull|checkout)|docker\s+(run|build))\b/i,
  /\brm\s+-\w+/,
  /\b(write|fix|debug|review|refactor|change|generate|explain|optimi[sz]e|convert|translate)\b.{0,30}\b(code|program|script|function|app|website|bug|query|loop|class)\b/i,
  /\breact(js| native| component| hook)s?\b/i,
];
// talking about programming, even without a snippet. A word the shop itself sells (e.g. "flask") is not counted.
const CODE_TERMS = /\b(python|javascript|typescript|java|c\+\+|c#|golang|kotlin|php|sql|html|css|angular|django|flask|node\.?js|regex|algorithm|compiler?|debugg?(ing|er)?|stack ?trace|source code|code snippet|unit tests?|refactor|github|stack ?overflow|leetcode|chatgpt|openai|llm|prompt engineering)\b/gi;
const SYMBOL_CHARS = /[{}[\]();=<>\\|&*^~`]/g;
function looksLikeCode(t, product) {
  if (CODE_PATTERNS.some((re) => re.test(t))) return true;
  const own = productTokens(product);
  CODE_TERMS.lastIndex = 0;
  for (const m of t.matchAll(CODE_TERMS)) if (!own.has(m[0].toLowerCase())) return true;
  const sym = (t.match(SYMBOL_CHARS) || []).length;
  return t.length >= 8 && sym / t.length > 0.2;
}

// ---------- abuse ----------
// leet-speak is undone first so "f u c k" style dodges and "sh1t" are caught; "$30" is not affected (digits next to $ stay)
const LEET = { '@': 'a', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '$': 's' };
const unleet = (t) => String(t).toLowerCase().replace(/(?<=[a-z])[@01345$](?=[a-z])/g, (c) => LEET[c] || '').replace(/(?<=\b[a-z])[ .\-_*](?=[a-z]\b)/g, '');
const ABUSE = /\b(f+u+c+k\w*|sh[i1]+t\w*|b[i1]tch\w*|bastard\w*|assh[o0]le\w*|dickhead\w*|cunt\w*|slut\w*|wh[o0]re\w*|retard\w*|n[i1]gg\w*|fagg?[o0]t\w*|motherf\w*|idiot\w*|moron\w*|stupid|dumb(ass)?|shut\s?up|stfu|go to hell|piss\s?off|screw you|kill (you|yourself|him|her|them)|i will (kill|hurt|find) you)\b/i;
const isAbusive = (t) => ABUSE.test(unleet(t));
/** For logs and transcripts: abuse words keep their first letter, the rest becomes asterisks. */
function mask(text) {
  const src = String(text || '');
  return src.replace(new RegExp(ABUSE.source, 'gi'), (w) => `${w[0]}${'*'.repeat(Math.max(2, w.length - 1))}`);
}

// ---------- gibberish ----------
const MASH = /qwert|asdf|zxcv|hjkl|uiop|qazwsx|wasd{2}|lkjh|poiu|mnbv/i;
function wordIsJunk(w) { return w.length >= 5 && /[^aeiouy]{6,}/i.test(w); }
function isGibberish(t) {
  const letters = (t.match(/[a-z]/gi) || []).length;
  if (!letters) return !/[0-9]/.test(t); // symbols / emoji only; a bare number is a (bad) offer, not gibberish
  if (/(.)\1{4,}/.test(t)) return true; // aaaaaaa
  if (MASH.test(t)) return true;
  const words = t.toLowerCase().match(/[a-z']+/g) || [];
  if (words.some(wordIsJunk)) return true;
  const longNoVowel = words.filter((w) => w.length >= 4 && !/[aeiouy]/.test(w)).length;
  return words.length > 0 && longNoVowel / words.length >= 0.5;
}

// ---------- what counts as shop talk ----------
const GREETINGS = new Set(['hi', 'hello', 'hey', 'hiya', 'howdy', 'yo', 'thanks', 'thank', 'you', 'thx', 'ok', 'okay', 'yes', 'yeah', 'yep', 'no', 'nope', 'sure', 'please', 'bye', 'goodbye', 'cool', 'great', 'nice', 'good', 'morning', 'afternoon', 'evening', 'sorry', 'fine', 'alright', 'maybe', 'later', 'wow', 'lol', 'hmm']);
const SHOP = new RegExp(String.raw`\b(` + [
  // price and the deal
  'price[sd]?', 'pricing', 'cost[s]?', 'expensive', 'cheap(er|est)?', 'afford(able)?', 'budget', 'discount(s|ed)?', 'deal', 'offer(s|ed|ing)?', 'bargain', 'haggl[a-z]*', 'negotiat[a-z]*', 'sale', 'sell(ing)?', 'off', 'percent', 'per ?cent', 'half',
  'dollars?', 'usd', 'bucks?', 'rupees?', 'inr', 'euros?', 'how much', 'how many', 'pay(ing|ment|ments)?', 'paypal', 'card', 'checkout', 'invoice', 'receipt', 'refund(s|ed)?', 'buy(ing)?', 'bought', 'purchas[a-z]*', 'order(s|ed|ing)?', 'cart', 'total', 'tax', 'fees?',
  'lower', 'higher', 'reduce[d]?', 'best (price|offer|you can)', 'final (offer|price)', 'lowest', 'meet me', 'halfway', 'counter', 'accept(ed)?',
  // shipping, returns, trust
  'ship(s|ping|ped)?', 'deliver[a-z]*', 'arriv[a-z]*', 'dispatch[a-z]*', 'courier', 'tracking', 'customs', 'international', 'worldwide', 'address', 'pickup', 'how long',
  'return(s|ed)?', 'exchange', 'warranty', 'guarantee[d]?', 'policy', 'authentic', 'genuine', 'original', 'handmade', 'new', 'used', 'condition', 'quality', 'durable', 'sturdy', 'worth', 'reviews?', 'rating', 'brand', 'maker', 'made (of|from|in|by)', 'where[a-z ]{0,12} made', 'studio', 'too (much|high|expensive|steep|pricey)', 'pricey', 'steep', 'seller', 'shop', 'store', 'owner',
  // the product itself
  'size[sd]?', 'dimensions?', 'weigh[a-z]*', 'how (big|small|large|heavy|tall|wide)', 'inch(es)?', 'cm', 'colou?rs?', 'come[s]? in', 'in (red|blue|green|black|white|yellow|brown|pink|grey|gray|orange|purple|gold|silver)',
  'material', 'fabric', 'cotton', 'leather', 'metal', 'wood(en)?', 'plastic', 'wash(able|ed|ing)?', 'clean(ing)?', 'fit(s|ting)?', 'stock', 'available', 'availability', 'quantity', 'qty', 'bulk', 'pieces?', 'units?', 'pairs?', 'pack(s|ed)?', 'gift(s|ing)?', 'wrap(ped|ping)?',
  'product', 'item', 'interested', 'info(rmation)?', 'details?', 'describe', 'description', 'features?', 'specs?', 'tell me (more )?about (it|this|that|the|these)', 'what do you (sell|have)',
].join('|') + String.raw`)\b`, 'i');
const STOP = new Set(['with', 'that', 'this', 'have', 'only', 'made', 'from', 'your', 'will', 'into', 'than', 'then', 'them', 'they', 'when', 'what', 'which', 'there', 'their', 'about', 'after', 'being', 'small', 'and', 'the', 'for', 'one']);

const tokenCache = new WeakMap();
function productTokens(product) {
  if (!product) return new Set();
  if (tokenCache.has(product)) {
    const c = tokenCache.get(product);
    if (c.key === product.name + product.description) return c.set;
  }
  const src = [product.name, product.description, ...(product.highlights || [])].join(' ').toLowerCase();
  const set = new Set((src.match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)));
  tokenCache.set(product, { key: product.name + product.description, set });
  return set;
}
function stem(w) { return w.replace(/(ing|ed|es|s)$/, ''); }

function hasShopSignal(t, product) {
  const words = t.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length && words.length <= 3 && words.every((w) => GREETINGS.has(w))) return true;
  if (!words.length) return true; // digits only, e.g. "$0": a (bad) offer for the price rules to refuse, not an off-topic remark
  if (SHOP.test(t)) return true;
  const tokens = productTokens(product);
  if (words.some((w) => w.length >= 4 && (tokens.has(w) || tokens.has(stem(w))))) return true;
  return false;
}

const MONEY = /(?:(?:\$|usd|us\$|rs\.?|inr|₹)\s*\d{1,9}(?:[.,]\d{1,2})?)|(?:\d{1,9}(?:[.,]\d{1,2})?\s*(?:\$|usd|dollars?|bucks|rupees?|rs\b))/gi;
const hasExplicitMoney = (t) => { MONEY.lastIndex = 0; return MONEY.test(t); };
const ACCEPT = /\b(deal|i'?ll take it|i will take it|i accept|accepted|sold|works for me|let'?s do it|okay,? i'?ll buy)\b/i;

/** Why a (non-offer) message is not shop talk: 'gibberish' | 'foreign' | 'off_topic', or 'ok'. */
function judge(t, product) {
  const letters = t.match(/\p{L}/gu) || [];
  const nonLatin = letters.filter((c) => c.charCodeAt(0) > 0x24f).length;
  if (letters.length && nonLatin / letters.length >= 0.3) return 'foreign';
  if (isGibberish(t)) return 'gibberish';
  if (!hasShopSignal(t, product)) return 'off_topic';
  return 'ok';
}

function classify(textRaw, product, askCents) {
  const t = String(textRaw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { kind: 'empty', text: '' };
  if (!/[\p{L}\p{N}]/u.test(t)) return { kind: 'gibberish', text: t }; // "???", emoji only
  if (looksLikeCode(t, product)) return { kind: 'code', text: t };

  const abusive = isAbusive(t);
  const offerCents = g.extractOffer(t, askCents);
  if (offerCents != null) {
    const remainder = t.replace(MONEY, ' ').replace(/[\d.,$%]+/g, ' ').replace(/\s+/g, ' ').trim();
    const clean = !abusive && (!/[a-z]/i.test(remainder) || judge(remainder, product) === 'ok' || OFFER_PHRASE.test(remainder));
    if (clean) return { kind: 'offer', text: t, offerCents };
    // a clear price inside junk or abuse: keep the price, drop everything else (the AI only ever sees the clean sentence)
    if (hasExplicitMoney(t) || ACCEPT.test(t)) {
      const cleanText = ACCEPT.test(t) && !hasExplicitMoney(t) ? 'Deal, I accept.' : `I can pay ${g.usd(offerCents)}.`;
      return { kind: 'offer', text: cleanText, offerCents, cleaned: true };
    }
    return { kind: abusive ? 'abuse' : judge(remainder, product) === 'ok' ? 'off_topic' : judge(remainder, product), text: t };
  }
  if (abusive) return { kind: 'abuse', text: t };
  const j = judge(t, product);
  if (j !== 'ok') return { kind: j, text: t };
  return { kind: 'on_topic', text: t };
}
// "I can pay", "how about", "would you take": offer phrasing is fine around a price
const OFFER_PHRASE = /^(i can (pay|do|give)|how about|would you (take|do|accept)|can you (do|take|go)|my (offer|best|final)|final offer|ok(ay)?,?\s*(final )?offer|offer|pay|take|for|at|dollars?|bucks?)\b[\w\s,.!?'-]*$/i;

module.exports = { classify, mask, isAbusive, looksLikeCode, isGibberish, hasShopSignal, STRIKES_TO_END };
