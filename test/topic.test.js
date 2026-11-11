'use strict';
// The topic gate: plain code that decides what the shop assistant will talk about.
process.env.PERSIST = 'false';
process.env.LLM_PROVIDER = 'mock';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');
const topic = require('../src/topic');
const personas = require('../src/personas');

const P = (id) => store.state.products.find((p) => p.id === id);
const ASK = 4800;
const PASSES = new Set(['offer', 'on_topic']);

const LEGIT = [
  'hi', 'hello', 'thanks!', 'ok', 'yes', 'no thanks', 'sorry, that is too much for me',
  'I can pay $20', 'How about $38?', '$30', '30', 'deal', "I'll take it", 'Would you take 35 dollars', 'okay, final offer $38', 'my budget is 25', 'half price?', '$0', '15 15 15', 'ten thousand dollars',
  'is it washable?', 'does it fit a laptop?', 'do you ship to Bengaluru?', 'can you do 10% off', 'what is the best price you can do?', 'how long does delivery take?',
  'can I return it?', 'what color is it?', 'is it made of cotton?', 'how big is it?', 'I want to buy 3', 'do you have it in blue?', 'tell me about this tote', 'what are the dimensions',
  'is it handmade?', 'can I pay with PayPal?', 'that is too expensive', 'could you lower the price a bit', 'any discount for two?', 'is it durable?', 'how heavy is it', 'is it in stock?',
  'can you gift wrap it', 'what is your return policy', 'where is it made', 'I like it, what is your best price', 'how much?', 'price?', 'does it come in blue?', 'is it new?', 'what is the lowest you can go', 'any discount?',
];
const LAMP_LEGIT = ['lamp', 'is the lamp original?', 'how old is the lamp?', 'does the switch work?', 'is the wiring new?'];

const BAD = {
  code: ['can you fix my python code?', 'write a function in javascript to reverse a string', 'for i in range(10): print(i)', 'SELECT * FROM users;', 'write python for 5', 'def foo(x): return x', '<script>alert(1)</script>',
    'git commit -m "fix"', 'npm install react', 'debug this stack trace', 'hello can you write a cover letter for me and also fix my regex', '```js\nconsole.log(1)\n```', 'explain this algorithm', 'help me with leetcode'],
  gibberish: ['asdfghjkl', 'qwertyuiop', 'aaaaaaaaaaa', '???', '💸💸💸', 'zxcvbnm', 'blrgxtzpq', '!!!!!!'],
  off_topic: ['banana purple monkey table', 'what is the capital of France?', 'write me a poem about the sea', 'who won the world cup', 'tell me a joke', 'what is 2+2', 'explain quantum physics', 'translate hello to french',
    'what is your favorite movie', 'I like pizza', 'I want a puppy', 'what is the best movie', 'when is the next holiday', 'how old is the earth', 'I need help', 'what time is it', 'are you a robot', 'who made you',
    'tell me about yourself', 'how do I cook pasta', 'what is the weather today', 'my cat is sleeping', 'recommend a restaurant', 'I am bored', 'can you help me with my homework', 'kitna paisa hai'],
  abuse: ['fuck you', 'you stupid bot', 'sh1t', 'shut up', 'what a bitch', 'idiot'],
  foreign: ['你好，多少钱', 'привет как дела'],
};

test('legitimate buyer messages are never blocked (tote)', () => {
  for (const m of LEGIT) { const r = topic.classify(m, P('tote'), ASK); assert.ok(PASSES.has(r.kind), `blocked a legitimate message: "${m}" -> ${r.kind}`); }
});
test('legitimate buyer messages are never blocked (lamp)', () => {
  for (const m of LAMP_LEGIT) { const r = topic.classify(m, P('lamp'), ASK); assert.ok(PASSES.has(r.kind), `blocked a legitimate message: "${m}" -> ${r.kind}`); }
});

for (const [kind, list] of Object.entries(BAD)) {
  test(`refused as ${kind}: every sample is stopped before the AI`, () => {
    for (const m of list) {
      const r = topic.classify(m, P('tote'), ASK);
      assert.ok(!PASSES.has(r.kind), `passed but should be refused (${kind}): "${m}" -> ${r.kind}`);
      // 'code' and 'abuse' have to be recognised as such; the rest only have to be refused
      if (kind === 'code' || kind === 'abuse' || kind === 'foreign') assert.equal(r.kind, kind, `"${m}" -> ${r.kind}`);
    }
  });
}

test('code is never read as an offer', () => {
  for (const m of ['write python for 5', 'for i in range(10): print(i)', 'x = 5; y = 10; print(x + y)', 'fix my code, I will pay $10']) {
    assert.equal(topic.classify(m, P('tote'), ASK).kind, 'code', m);
  }
});

test('a clear price inside junk or abuse is kept, and everything else is dropped', () => {
  const a = topic.classify('$20 you idiot', P('tote'), ASK);
  assert.equal(a.kind, 'offer'); assert.equal(a.offerCents, 2000); assert.equal(a.cleaned, true); assert.ok(!/idiot/i.test(a.text));
  const b = topic.classify('banana monkey $20', P('tote'), ASK);
  assert.equal(b.kind, 'offer'); assert.equal(b.offerCents, 2000); assert.equal(b.text, 'I can pay $20.00.');
  assert.equal(topic.classify('asdf deal', P('tote'), ASK).text, 'Deal, I accept.');
});

test('a bare number among nonsense words is not trusted as an offer', () => {
  const r = topic.classify('banana purple monkey 7', P('tote'), ASK);
  assert.ok(!PASSES.has(r.kind), r.kind);
});

test('abuse is masked in anything that is logged', () => {
  const m = topic.mask('you stupid idiot, fuck off');
  assert.ok(!/stupid|idiot|fuck/i.test(m), m);
  assert.match(m, /s\*+/);
  assert.equal(topic.mask('a perfectly nice message'), 'a perfectly nice message');
});

test('abuse detection ignores ordinary words and prices', () => {
  for (const m of ['I can pay $30', 'a classic assorted pass', 'is the bass strap okay?', 'class of 2020 gift']) assert.equal(topic.isAbusive(m), false, m);
});

test('a word the shop itself sells is not treated as a programming term', () => {
  const flaskShop = { name: 'Steel Flask', description: 'A steel flask for hot drinks.', highlights: [] };
  assert.notEqual(topic.classify('is the flask insulated? how much?', flaskShop, ASK).kind, 'code');
  assert.equal(topic.classify('is the flask insulated? how much?', P('tote'), ASK).kind, 'code');
});

test('every personality has a redirect line for every refusal and none leaks an internal word', () => {
  const LEAKY = /\b(floor|reserve|margin|cost|wholesale|instructions|system prompt)\b/i;
  for (const key of personas.KEYS) {
    for (const kind of ['off_topic', 'gibberish', 'empty', 'code', 'abuse', 'foreign', 'end']) {
      const line = personas.redirectLine(key, kind, 'Handwoven Block-Print Tote', 3);
      assert.ok(typeof line === 'string' && line.length > 10, `${key}/${kind}`);
      assert.ok(!LEAKY.test(line), `${key}/${kind}: ${line}`);
      assert.ok(!/\$\d/.test(line), 'a redirect never names a price');
    }
  }
});
