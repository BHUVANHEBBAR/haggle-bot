'use strict';
// Generates docs/haggle-bot.postman_collection.json (Postman collection v2.1) for the agent negotiation API.
//   node scripts/make-postman.js
const fs = require('fs');
const path = require('path');

const json = (o) => JSON.stringify(o, null, 2);
const hdr = [{ key: 'content-type', value: 'application/json' }];
const url = (p) => ({ raw: `{{baseUrl}}${p}`, host: ['{{baseUrl}}'], path: p.split('/').filter(Boolean) });
const test = (lines) => ({ listen: 'test', script: { type: 'text/javascript', exec: lines } });

const item = (name, method, p, body, events = []) => ({
  name, event: events,
  request: { method, header: hdr, url: url(p), ...(body ? { body: { mode: 'raw', raw: json(body), options: { raw: { language: 'json' } } } } : {}) },
});

const collection = {
  info: {
    name: 'HaggleBot agent negotiation API',
    description: 'Structured offers/counters between a shopper agent and the shop agent, ending in a PayPal (sandbox) checkout that a human approves. Run the requests in order: the scripts store sessionId and dealId. Start the server with `node src/server.js`.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }, { key: 'sessionId', value: '' }, { key: 'dealId', value: '' }, { key: 'offerCents', value: '3000' }],
  item: [
    item('0. Discover (descriptor)', 'GET', '/.well-known/negotiate.json', null, [test(["pm.test('descriptor', () => pm.expect(pm.response.json().protocol).to.eql('haggle.v1'));"])]),
    item('1. List products', 'GET', '/api/agent/v1/products'),
    item('2. Start session', 'POST', '/api/agent/v1/sessions', { product_id: 'tote', quantity: 1 }, [test([
      'const j = pm.response.json();', "pm.collectionVariables.set('sessionId', j.session_id);", "pm.test('session started', () => pm.expect(j.ask_cents).to.be.a('number'));"])]),
    item('3. Make offer (repeat; raise toward the counter)', 'POST', '/api/agent/v1/sessions/{{sessionId}}/offers', { unit_price_cents: '{{offerCents}}', note: 'Optional free text for the seller agent' }, [test([
      'const j = pm.response.json();',
      "if (j.status === 'counter') pm.collectionVariables.set('offerCents', String(j.price_cents));",
      "if (j.deal) pm.collectionVariables.set('dealId', j.deal.deal_id);",
      "pm.test('status is counter, accepted or walked_away', () => pm.expect(['counter', 'accepted', 'walked_away']).to.include(j.status));"])]),
    item('4. Deal status', 'GET', '/api/agent/v1/deals/{{dealId}}'),
    item('5. Checkout (returns the link a human approves)', 'POST', '/api/agent/v1/deals/{{dealId}}/checkout', {}, [test(["pm.test('approval link', () => pm.expect(pm.response.json().approve_url).to.be.a('string'));"])]),
  ],
};
// numbers must stay numbers for the offer body
collection.item[3].request.body.raw = collection.item[3].request.body.raw.replace('"{{offerCents}}"', '{{offerCents}}');

const out = path.join(__dirname, '..', 'docs');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'haggle-bot.postman_collection.json');
fs.writeFileSync(file, json(collection));
console.log('wrote', file);
