'use strict';
/**
 * Open agent-to-agent negotiation API ("haggle.v1").
 * A shopper agent (a custom GPT, a script, another company's bot) negotiates with the shop's agent using
 * STRUCTURED offers in integer cents, then hands a PayPal approval link to its human, who approves the payment.
 *
 * Offers go through the same pipeline as the web chat (seller.respond), so the floor guarantee is identical:
 * code decides accept / counter / walk away, the AI only words the reply, and the price comes from the stored deal.
 * Compared with prose-only protocols, offers and counters are explicit fields, and the flow ends in a real payment.
 */

const OFFER_MAX_FACTOR = 5; // reject absurd offers (more than 5x list) outright

function descriptor(baseUrl, products) {
  return {
    protocol: 'haggle.v1',
    name: 'HaggleBot demo shop',
    description: 'AI haggling for small sellers. Code enforces the seller limits; the AI only words replies; PayPal (sandbox) collects the payment at the agreed price.',
    base_url: baseUrl,
    currency: 'USD',
    units: 'All prices are integer cents.',
    endpoints: {
      products: `${baseUrl}/api/agent/v1/products`,
      start_session: `${baseUrl}/api/agent/v1/sessions`,
      make_offer: `${baseUrl}/api/agent/v1/sessions/{session_id}/offers`,
      get_deal: `${baseUrl}/api/agent/v1/deals/{deal_id}`,
      checkout: `${baseUrl}/api/agent/v1/deals/{deal_id}/checkout`,
      openapi: `${baseUrl}/api/agent/v1/openapi.json`,
    },
    limits: { max_rounds: 6, offers_per_minute_per_ip: 60, deal_hold_minutes: 15 },
    guarantees: [
      'The seller never sells below its private limits; this is enforced in code, not in a prompt.',
      'The final price comes from the stored deal, never from the client.',
      'A human must approve the payment on the PayPal page (agent mandate). Sandbox money only.',
    ],
    products,
  };
}

function openapi(baseUrl) {
  const deal = { type: 'object', properties: { deal_id: { type: 'string' }, unit_cents: { type: 'integer' }, total_cents: { type: 'integer' }, quantity: { type: 'integer' }, expires_at: { type: 'string', format: 'date-time' } } };
  const err = { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } };
  return {
    openapi: '3.1.0',
    info: { title: 'HaggleBot agent negotiation API', version: '1.0.0', description: 'Structured offers and counters between a shopper agent and the shop agent, ending in a PayPal sandbox checkout that a human approves.', license: { name: 'MIT' } },
    servers: [{ url: baseUrl }],
    paths: {
      '/api/agent/v1/products': { get: { operationId: 'listProducts', summary: 'List products and list prices', responses: { 200: { description: 'Products' } } } },
      '/api/agent/v1/sessions': {
        post: {
          operationId: 'startSession', summary: 'Start a negotiation for one product',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 10, default: 1 } } } } } },
          responses: { 200: { description: 'Session started', content: { 'application/json': { schema: { type: 'object', properties: { session_id: { type: 'string' }, ask_cents: { type: 'integer' }, round: { type: 'integer' }, max_rounds: { type: 'integer' }, message: { type: 'string' } } } } } }, 404: err, 409: err },
        },
      },
      '/api/agent/v1/sessions/{session_id}/offers': {
        post: {
          operationId: 'makeOffer', summary: 'Offer a unit price in cents; get a counter, an acceptance, or a walk-away',
          parameters: [{ name: 'session_id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['unit_price_cents'], properties: { unit_price_cents: { type: 'integer', minimum: 1 }, note: { type: 'string', maxLength: 200, description: 'Optional free text for the seller agent (untrusted input).' } } } } } },
          responses: {
            200: { description: 'Seller response', content: { 'application/json': { schema: { type: 'object', properties: { status: { enum: ['counter', 'accepted', 'walked_away'] }, price_cents: { type: 'integer', description: 'Counter price, or the agreed unit price when accepted' }, message: { type: 'string' }, round: { type: 'integer' }, rounds_left: { type: 'integer' }, deal: deal } } } } },
            404: err, 409: err, 429: err,
          },
        },
      },
      '/api/agent/v1/deals/{deal_id}': { get: { operationId: 'getDeal', summary: 'Deal status', parameters: [{ name: 'deal_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deal' }, 404: err } } },
      '/api/agent/v1/deals/{deal_id}/checkout': {
        post: {
          operationId: 'startCheckout', summary: 'Create the PayPal order for an agreed deal and return the approval link for the human',
          parameters: [{ name: 'deal_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Approval link', content: { 'application/json': { schema: { type: 'object', properties: { approve_url: { type: 'string' }, order_id: { type: 'string' }, mode: { enum: ['sandbox', 'simulated'] } } } } } }, 404: err, 409: err },
        },
      },
    },
  };
}

/** Registers the routes on the server's router. Everything is injected so this file stays easy to test. */
function install({ route, HttpError, readJson, rateLimit, store, seller, payments, g, usd, config, startChat, publicProduct }) {
  const base = () => config.baseUrl;
  const agentProduct = (p) => ({ id: p.id, name: p.name, description: p.description, list_price_cents: p.listCents, in_stock: p.stock > 0, pay_mode: p.payMode });

  route('GET', '/.well-known/negotiate.json', async () => ({ status: 200, body: descriptor(base(), store.state.products.map(agentProduct)) }));
  route('GET', '/api/agent/v1/openapi.json', async () => ({ status: 200, body: openapi(base()) }));
  route('GET', '/api/agent/v1/products', async () => ({ status: 200, body: { currency: 'USD', products: store.state.products.map(agentProduct) } }));

  route('POST', '/api/agent/v1/sessions', async (req) => {
    rateLimit(req, 'agent-start', 30);
    const b = await readJson(req);
    const { s, product, qty, opening } = startChat(b.product_id, b.quantity);
    return { status: 200, body: { session_id: s.id, product: agentProduct(product), quantity: qty, ask_cents: s.askCents, round: 0, max_rounds: g.MAX_ROUNDS, message: opening } };
  });

  route('POST', '/api/agent/v1/sessions/([a-f0-9]+)/offers', async (req, m) => {
    rateLimit(req, 'agent-offer', 60);
    const s = store.getSession(m[1]);
    if (!s) throw new HttpError(404, 'Session expired or unknown. Start a new one.');
    if (s.status !== 'open') throw new HttpError(409, s.status === 'agreed' ? 'A deal was already agreed in this session.' : 'This negotiation has ended.');
    const b = await readJson(req);
    const cents = b.unit_price_cents;
    const product = store.getProduct(s.productId);
    if (!Number.isInteger(cents) || cents < 1 || cents > product.listCents * OFFER_MAX_FACTOR) throw new HttpError(400, 'unit_price_cents must be a positive integer number of cents');
    const note = typeof b.note === 'string' ? b.note.replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
    // The structured offer is turned into the same text the web chat would carry, so one pipeline (and one set of guardrails) handles both.
    const r = await seller.respond(s, `I offer ${usd(cents)} per unit.${note ? ` ${note}` : ''}`);
    const status = { accept: 'accepted', counter: 'counter', walk_away: 'walked_away' }[r.action] || 'counter';
    return { status: 200, body: {
      status, price_cents: r.priceCents, message: r.message, round: r.round, rounds_left: Math.max(0, g.MAX_ROUNDS - r.round),
      deal: r.deal ? { deal_id: r.deal.id, unit_cents: r.deal.unitCents, total_cents: r.deal.totalCents, quantity: r.deal.qty, expires_at: r.deal.expiresAt } : null,
    } };
  });

  route('GET', '/api/agent/v1/deals/([a-f0-9]+)', async (req, m) => {
    const d = store.getDeal(m[1]);
    if (!d) throw new HttpError(404, 'Unknown deal');
    return { status: 200, body: { deal_id: d.id, status: d.status, product: d.productName, quantity: d.qty, unit_cents: d.unitCents, total_cents: d.totalCents, list_total_cents: d.listTotalCents, expires_at: d.expiresAt } };
  });

  route('POST', '/api/agent/v1/deals/([a-f0-9]+)/checkout', async (req, m) => {
    rateLimit(req, 'agent-checkout', 20);
    const r = await payments.startCheckout(m[1]);
    return { status: 200, body: { approve_url: r.approveUrl, order_id: r.orderId, mode: r.mode, note: 'A human must open approve_url and approve the payment. The amount is fixed by the stored deal.' } };
  });
}

module.exports = { install, descriptor, openapi };
