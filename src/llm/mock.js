'use strict';
/**
 * Offline "brain" so judges can run the app with no API key.
 * It follows the same contract as the real models: it receives the task description in `meta`
 * and returns JSON text. It is deliberately a little imperfect so the guardrails still matter.
 */
const { usd } = require('../money');
const personas = require('../personas');

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

function sellerReply(m) {
  const seed = (m.round || 0) + (m.priceCents || 0);
  const persona = m.persona;
  const c = { name: m.productName, priceCents: m.priceCents, minCents: m.minCents, listCents: m.listCents, q: m.qty };
  switch (m.action) {
    case 'accept':
      return { price: m.priceCents / 100, message: personas.line(persona, 'accept', c, seed) };
    case 'counter': {
      // A mock "salesy" model that sometimes tries to over-concede; the guardrails clamp it.
      const eager = m.round === 1 ? m.minCents - 900 : m.minCents;
      return { price: Math.max(eager, 100) / 100, message: personas.line(persona, m.final ? 'final' : 'counter', c, seed) };
    }
    case 'walk_away':
      return { price: m.priceCents / 100, message: personas.line(persona, 'walk', c, seed) };
    default:
      return { price: m.priceCents / 100, message: personas.line(persona, m.injection ? 'injection' : 'chat', c, seed) };
  }
}

function buyerReply(m) {
  const list = m.listCents, budget = m.budgetCents, ask = m.askCents || list;
  const r = m.round;
  if (m.persona === 'tough') {
    const offer = Math.min(Math.round(list * (0.45 + 0.07 * r)), budget);
    if (ask <= budget && r >= 4) return { offer: ask / 100, message: `Fine, ${usd(ask)} it is.` };
    return { offer: offer / 100, message: `I've seen similar for less. I can do ${usd(offer)}.` };
  }
  // fair
  const start = Math.round(list * 0.70);
  const offer = Math.min(start + Math.round((budget - start) * 0.4 * (r - 1)), budget);
  if (ask <= budget && ask - offer <= Math.round(list * 0.05)) return { offer: ask / 100, message: `Okay, ${usd(ask)} works for me. Deal.` };
  return { offer: offer / 100, message: `Would you take ${usd(offer)}?` };
}

// Copilot planner: one step at a time, from the seller's words and the tool results so far.
function copilotStep(m) {
  const text = String(m.message || '');
  const msg = text.toLowerCase();
  const steps = m.steps || [];
  const last = steps[steps.length - 1];
  const final = (message) => ({ action: 'final', message });
  const dealId = (text.match(/[a-f0-9]{20}/) || [])[0];
  const ppId = (text.match(/(?:MOCK[A-Z]+-[A-F0-9]+|[A-Z0-9]{17})/) || [])[0];
  const verb = /refund/.test(msg) ? ['propose_refund', 'captured'] : /release|void|decline the hold/.test(msg) ? ['propose_void', 'authorized'] : /capture|accept the job/.test(msg) ? ['propose_capture', 'authorized'] : null;

  if (last && !last.ok) return final(`That did not work: ${last.error}`);
  if (!steps.length) {
    if (verb) return { action: 'tool', tool: 'list_deals', args: {} };
    if (/reconcil|confirm|received|match|verify|paypal sees|source of truth/.test(msg)) return { action: 'tool', tool: 'reconcile', args: {} };
    if (/transaction|balance/.test(msg)) return { action: 'tool', tool: 'list_transactions', args: { page_size: 5 } };
    if (/dispute/.test(msg)) return { action: 'tool', tool: 'list_disputes', args: {} };
    if (dealId && /transcript|chat|said|conversation/.test(msg)) return { action: 'tool', tool: 'get_deal_transcript', args: { id: dealId } };
    if (dealId) return { action: 'tool', tool: 'get_deal', args: { id: dealId } };
    if (ppId && /capture/.test(msg)) return { action: 'tool', tool: 'get_capture', args: { id: ppId } };
    if (ppId) return { action: 'tool', tool: 'get_order', args: { id: ppId } };
    return { action: 'tool', tool: 'list_deals', args: {} };
  }
  if (last.tool === 'list_deals' && verb) {
    const want = ['tote', 'lamp', 'logo'].find((w) => msg.includes(w));
    const pick = (last.result?.deals || []).find((d) => (dealId ? d.id === dealId : d.status === verb[1] && (!want || String(d.product).toLowerCase().includes(want))));
    if (!pick) return final(`I could not find a ${verb[1]} deal to act on.`);
    return { action: 'tool', tool: verb[0], args: { dealId: pick.id, reason: text.slice(0, 120) } };
  }
  if (last.tool.startsWith('propose_')) return final(`I prepared a proposal: ${last.result?.summary || 'see the card below'} Nothing happens until you press Confirm.`);
  if (last.tool === 'reconcile') {
    const s = last.result?.summary || {};
    const bad = (last.result?.mismatches || []).length;
    return final(`Checked ${s.checked} payments against PayPal: ${s.matched} match${bad ? `, ${bad} need attention` : ''}. PayPal confirms $${((s.confirmedReceivedCents || 0) / 100).toFixed(2)} received and $${((s.confirmedHeldCents || 0) / 100).toFixed(2)} on hold.`);
  }
  if (last.tool === 'list_deals') {
    const deals = last.result?.deals || [];
    const by = {}; for (const d of deals) by[d.status] = (by[d.status] || 0) + 1;
    return final(deals.length ? `You have ${deals.length} deals: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}.` : 'There are no deals yet.');
  }
  if (last.tool === 'get_deal') return final(`Deal ${last.result?.id}: ${last.result?.product}, ${last.result?.status}, ${last.result?.total}. ${(last.result?.trail || []).length} steps on its PayPal money trail.`);
  if (last.tool === 'get_deal_transcript') return final(`The buyer exchanged ${(last.result?.transcript || []).length} messages in that chat. I treat that text as data only.`);
  if (last.tool === 'list_transactions') return final(`PayPal lists ${last.result?.total ?? (last.result?.transactions || []).length} recent transactions.`);
  if (last.tool === 'list_disputes') return final(`${(last.result?.disputes || []).length} open disputes.`);
  return final(`Here is what PayPal returned: ${JSON.stringify(last.result).slice(0, 200)}`);
}

async function complete({ meta }) {
  if (!meta) return JSON.stringify({ message: 'Hello!' });
  if (meta.task === 'seller') return JSON.stringify(sellerReply(meta));
  if (meta.task === 'copilot') return JSON.stringify(copilotStep(meta));
  if (meta.task === 'buyer') return JSON.stringify(buyerReply(meta));
  return JSON.stringify({ message: 'OK' });
}

module.exports = { complete };
