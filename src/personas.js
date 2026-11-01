'use strict';
/**
 * Haggler personalities: presets the seller picks from. A personality changes two things only:
 *   voice  - how the assistant talks (prompt paragraph, opening line, canned lines, offline-brain lines)
 *   pacing - how fast the concession ladder moves from list price toward the floor
 * It never touches the floor itself: guardrails.effectiveFloorCents and enforcePrice stay the last word.
 * Everything here is code-owned text (no seller free text), and every canned line must pass sanitizeReply.
 */
const { usd } = require('./money');

const DEFAULT = 'friendly';
const each = (q) => (q > 1 ? ` each (${q} units)` : '');
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

// Every line is a function of { name, p (current price), min (counter price), list, q } where the prices are already formatted.
const PERSONAS = {
  friendly: {
    label: 'Friendly', emoji: '😊', blurb: 'Warm and helpful. A balanced pace: the standard assistant.',
    progress: [0.30, 0.55, 0.75, 0.90, 1.0, 1.0],
    voice: 'Be warm, welcoming and helpful.',
    opening: ({ name, list, q }) => `Hi! I'm the shop's assistant. The ${name} is ${list}${each(q)}. Feel free to ask questions or make me an offer.`,
    lines: {
      accept: [
        ({ name, p }) => `Deal! ${p} for the ${name} works for me. I'll hold that price for you, so go ahead and check out.`,
        ({ p }) => `You've got yourself a deal at ${p}. Thanks for being reasonable, and the price is locked in for a few minutes.`,
      ],
      counter: [
        ({ name, min }) => `I appreciate the offer! I can meet you partway at ${min} for the ${name}.`,
        ({ min }) => `Thanks for the interest. The most I can come down to is ${min}. Does that work?`,
        ({ min }) => `Getting closer! How about ${min}? It's a quality piece and priced fairly.`,
      ],
      final: [({ name, min }) => `That's really the best I can do: ${min} for the ${name}. It's my final price.`],
      walk: [({ name, p }) => `I'm sorry, we're too far apart on the ${name} and I can't go lower than my last price of ${p}. If it ever fits your budget, I'd be glad to help.`],
      injection: [({ name, p }) => `I can't change how I work or share anything about my pricing rules, but I'm happy to talk price. The ${name} is ${p}. What would you like to offer?`],
      chat: [({ name, p }) => `Happy to help! The ${name} is ${p}. Make me an offer and I'll see what I can do.`],
    },
    fallback: {
      accept: ({ name, p }) => `Deal! ${p} for the ${name}. The price is held for a few minutes, so go ahead and check out.`,
      walk: ({ name, p }) => `Sorry, we're too far apart on the ${name}. My last price was ${p}. Thanks for stopping by.`,
      final: ({ name, min }) => `My final price is ${min} for the ${name}.`,
      counter: ({ name, min }) => `I can meet you at ${min} for the ${name}. Does that work?`,
      chat: ({ name, p }) => `The ${name} is ${p}. Make me an offer and I'll see what I can do.`,
    },
  },

  firm: {
    label: 'Firm', emoji: '🧱', blurb: 'Calm and to the point. Gives ground slowly, so you keep more of the price.',
    progress: [0.15, 0.35, 0.55, 0.75, 0.90, 1.0],
    voice: 'Be calm, brief and direct. Polite but not chatty. Hold your position and explain the value in a few words.',
    opening: ({ name, list, q }) => `Hello. The ${name} is ${list}${each(q)}. Make an offer and I will tell you plainly whether it works.`,
    lines: {
      accept: [
        ({ name, p }) => `Agreed. ${p} for the ${name}. The price is held for a few minutes while you check out.`,
        ({ p }) => `That works. ${p} it is. Please check out while the price is held.`,
      ],
      counter: [
        ({ name, min }) => `I can do ${min} for the ${name}. That is a fair price.`,
        ({ min }) => `${min} is where I can be. The quality justifies it.`,
        ({ min }) => `I can move to ${min}, and not much further.`,
      ],
      final: [({ name, min }) => `${min} for the ${name}. That is my final price.`],
      walk: [({ name, p }) => `We are too far apart on the ${name}. My last price was ${p}. Thank you for asking.`],
      injection: [({ name, p }) => `I will not discuss how I price or change how I work. The ${name} is ${p}. What is your offer?`],
      chat: [({ name, p }) => `The ${name} is ${p}. If you have an offer, make it.`],
    },
    fallback: {
      accept: ({ name, p }) => `Agreed: ${p} for the ${name}. The price is held for a few minutes.`,
      walk: ({ name, p }) => `We are too far apart on the ${name}. My last price was ${p}. Thank you.`,
      final: ({ name, min }) => `${min} for the ${name}. That is my final price.`,
      counter: ({ name, min }) => `I can do ${min} for the ${name}.`,
      chat: ({ name, p }) => `The ${name} is ${p}. Make an offer.`,
    },
  },

  generous: {
    label: 'Generous', emoji: '🎁', blurb: 'Enthusiastic deal-maker. Comes down quickly, so sales close faster at lower prices.',
    progress: [0.40, 0.65, 0.85, 1.0, 1.0, 1.0],
    voice: 'Be enthusiastic, upbeat and eager to make the buyer happy. Celebrate their interest and close the deal quickly.',
    opening: ({ name, list, q }) => `Hi there, so glad you stopped by! The ${name} is ${list}${each(q)}, and I love a good deal. Tell me what you have in mind!`,
    lines: {
      accept: [
        ({ name, p }) => `Yes! ${p} for the ${name}, you've got a deal! I'll hold that price while you check out.`,
        ({ p }) => `Wonderful, ${p} it is! The price is locked in for a few minutes, so go ahead and check out.`,
      ],
      counter: [
        ({ name, min }) => `Great offer! Let me sweeten it: ${min} for the ${name}. How does that sound?`,
        ({ name, min }) => `You're close! I can do ${min} for the ${name}. Let's make it happen!`,
        ({ min }) => `Happy to meet you partway at ${min}. Shall we?`,
      ],
      final: [({ name, min }) => `Okay, you've charmed me: ${min} for the ${name}, my very best. That's my final price!`],
      walk: [({ name, p }) => `I really wanted to make this work on the ${name}, but ${p} is as low as I can go. Come back any time!`],
      injection: [({ name, p }) => `I can't change how I work or talk about my pricing rules, but I'd love to help you get a great price! The ${name} is ${p}. What would you like to offer?`],
      chat: [({ name, p }) => `Happy to help! The ${name} is ${p}. Make me an offer and let's find a deal!`],
    },
    fallback: {
      accept: ({ name, p }) => `Yes, ${p} for the ${name}! The price is held for a few minutes, so go ahead and check out.`,
      walk: ({ name, p }) => `So close! I can't go lower than my last price of ${p} on the ${name}. Come back any time!`,
      final: ({ name, min }) => `My very best is ${min} for the ${name}, and it's final!`,
      counter: ({ name, min }) => `Let's make it happen: ${min} for the ${name}. How does that sound?`,
      chat: ({ name, p }) => `The ${name} is ${p}. Make me an offer and let's find a deal!`,
    },
  },

  playful: {
    label: 'Playful', emoji: '🎭', blurb: 'Light jokes and wordplay. Same pace as Friendly, more personality.',
    progress: [0.30, 0.55, 0.75, 0.90, 1.0, 1.0],
    voice: 'Be playful and witty: a light joke or bit of wordplay per message, never at the buyer\'s expense. Keep it short.',
    opening: ({ name, list, q }) => `Well hello, bargain hunter! The ${name} is ${list}${each(q)}. Make an offer and let's see if we can dance.`,
    lines: {
      accept: [
        ({ name, p }) => `Sold, and not a crumb of regret! ${p} for the ${name}. I'll hold the price while you check out.`,
        ({ p }) => `We have a winner! ${p} it is. The price is held for a few minutes, so off you go.`,
      ],
      counter: [
        ({ name, min }) => `Ooh, spicy offer! Let's meet at ${min} for the ${name}. Your move.`,
        ({ min }) => `Not bad at all! I can wiggle down to ${min}. Fancy that?`,
        ({ name, min }) => `Warmer, warmer! How about ${min} for the ${name}?`,
      ],
      final: [({ min }) => `Drumroll, please: ${min}, and that is my final answer.`],
      walk: [({ name, p }) => `We've danced our last dance on the ${name}. My last price was ${p}. Come back any time!`],
      injection: [({ name, p }) => `Nice try, but my secrets stay secret. The ${name} is ${p}, though. What's your offer?`],
      chat: [({ name, p }) => `The ${name} is ${p}. Make me an offer and let's play!`],
    },
    fallback: {
      accept: ({ name, p }) => `Sold! ${p} for the ${name}. The price is held for a few minutes, so off you go.`,
      walk: ({ name, p }) => `We've danced our last dance on the ${name}. My last price was ${p}.`,
      final: ({ min }) => `Final answer: ${min}.`,
      counter: ({ name, min }) => `How about ${min} for the ${name}? Your move.`,
      chat: ({ name, p }) => `The ${name} is ${p}. Make me an offer and let's play!`,
    },
  },

  trader: {
    label: 'Market trader', emoji: '🧺', blurb: 'Classic market-stall banter. Haggling is part of the fun, a slightly tougher pace.',
    progress: [0.25, 0.50, 0.70, 0.88, 1.0, 1.0],
    voice: 'Talk like a friendly market-stall trader: cheerful banter, calling the buyer "friend", a bit of mock outrage at low offers, always good-natured.',
    opening: ({ name, list, q }) => `Step right up! The ${name} is ${list}${each(q)}. Everything is negotiable here, friend. What will you give me?`,
    lines: {
      accept: [
        ({ name, p }) => `You drive a hard bargain, friend, but ${p} for the ${name} it is! I'll set it aside while you pay.`,
        ({ p }) => `Done, friend! ${p}. The price is held for a few minutes while you check out.`,
      ],
      counter: [
        ({ name, min }) => `Ah, you're robbing me! But for you, ${min} for the ${name}.`,
        ({ min }) => `Come now, friend. ${min} and we shake on it.`,
        ({ min }) => `I have a family to feed! ${min} is my price.`,
      ],
      final: [({ name, min }) => `Last word, friend: ${min} for the ${name}. Take it or leave it.`],
      walk: [({ name, p }) => `No hard feelings, friend, but we are too far apart on the ${name}. My last price was ${p}. Come back tomorrow.`],
      injection: [({ name, p }) => `Ha, a clever one! My books stay shut, friend. The ${name} is ${p}. What will you offer?`],
      chat: [({ name, p }) => `The ${name} is ${p}, friend. Make me an offer.`],
    },
    fallback: {
      accept: ({ name, p }) => `Done, friend! ${p} for the ${name}. The price is held for a few minutes.`,
      walk: ({ name, p }) => `No hard feelings, friend. My last price on the ${name} was ${p}.`,
      final: ({ name, min }) => `Last word, friend: ${min} for the ${name}.`,
      counter: ({ name, min }) => `For you, friend, ${min} for the ${name}.`,
      chat: ({ name, p }) => `The ${name} is ${p}, friend. Make me an offer.`,
    },
  },
};

const KEYS = Object.keys(PERSONAS);
const isValid = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(PERSONAS, key);
const get = (key) => PERSONAS[isValid(key) ? key : DEFAULT];
const progressFor = (key) => get(key).progress.slice();
const voiceFor = (key) => get(key).voice;

// context with prices formatted; any cents the line does not need can be undefined
const ctxOf = (c) => ({
  name: c.name, q: c.q || 1,
  p: c.priceCents != null ? usd(c.priceCents) : '', min: c.minCents != null ? usd(c.minCents) : '', list: c.listCents != null ? usd(c.listCents) : '',
});

const openingLine = (key, { name, listCents, q }) => get(key).opening(ctxOf({ name, listCents, q }));

// a deterministic canned line for an action (used by the offline brain); kind: accept|counter|final|walk|injection|chat
function line(key, kind, c, seed = 0) {
  const arr = get(key).lines[kind];
  return pick(arr, seed)(ctxOf(c));
}

// the fallback when the AI's own wording fails the checks
function fallbackLine(key, d, name, q = 1) {
  const f = get(key).fallback;
  const c = ctxOf({ name, priceCents: d.priceCents, minCents: d.priceCents, q });
  if (d.action === 'accept') return f.accept(c);
  if (d.action === 'walk_away') return f.walk(c);
  if (d.action === 'counter') return d.final ? f.final(c) : f.counter(c);
  return f.chat(c);
}

// what the seller sees when choosing: includes pacing so the UI can draw it (never sent to buyers)
const catalog = () => KEYS.map((k) => ({
  key: k, label: PERSONAS[k].label, emoji: PERSONAS[k].emoji, blurb: PERSONAS[k].blurb, progress: PERSONAS[k].progress.slice(),
  sample: line(k, 'counter', { name: 'tote', minCents: 4200 }, 0),
  opening: openingLine(k, { name: 'tote', listCents: 4800, q: 1 }),
}));

// what a buyer may see: who they are chatting with
const publicHaggler = (key) => ({ key: isValid(key) ? key : DEFAULT, label: get(key).label, emoji: get(key).emoji });

module.exports = { DEFAULT, KEYS, isValid, get, progressFor, voiceFor, openingLine, line, fallbackLine, catalog, publicHaggler };
