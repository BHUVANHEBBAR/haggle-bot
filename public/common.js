/* Shared helpers. Everything user-visible is set with textContent to avoid HTML injection. */
const $ = (sel, root = document) => root.querySelector(sel);
const usd = (c) => `$${(c / 100).toFixed(2)}`;
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ---------- inline SVG icons (static markup defined here, never user text) ----------
const ICONS = {
  logo: '<rect x="3" y="3" width="26" height="26" rx="8" fill="#2563eb"/><path d="M9 20.5l5.2-5.2 3 3L23 12.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23" cy="12.5" r="2" fill="#fdba74"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/><path d="M7.5 15h9"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.6-1.2M12 6v2M12 16v2"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01M9 17.5h6"/>',
};
function icon(name, size) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', name === 'logo' ? '0 0 32 32' : '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (name !== 'logo') for (const [k, v] of [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) s.setAttribute(k, v);
  if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
  s.innerHTML = ICONS[name] || ''; // ICONS is a fixed table above
  return s;
}

async function header(active) {
  const h = $('header.top');
  h.append(
    el('a', { href: '/', class: 'logo', 'aria-label': 'HaggleBot home' }, icon('logo'), el('div', {}, 'Haggle', el('span', {}, 'Bot'))),
    el('nav', { 'aria-label': 'Main' },
      el('a', { href: '/', class: active === 'shop' ? 'on' : '', 'aria-current': active === 'shop' ? 'page' : null }, 'Shop'),
      el('a', { href: '/battle.html', class: active === 'battle' ? 'on' : '', 'aria-current': active === 'battle' ? 'page' : null }, 'Agent vs agent'),
      el('a', { href: '/seller.html', class: active === 'seller' ? 'on' : '', 'aria-current': active === 'seller' ? 'page' : null }, 'Seller dashboard')),
  );
  h.append(el('div', { class: 'badges', id: 'badges' }));
  await refreshBadge();
}
const brainName = (p) => (p === 'mock' || p === 'none' ? 'offline brain' : p === 'compat' ? 'alternate model' : p);
// Header badges reflect the last real AI call (from /api/health), not just the configuration.
async function refreshBadge() {
  const box = $('#badges'); if (!box) return;
  try {
    const m = await api('/api/health');
    configuredAi = m.ai;
    const s = m.aiStatus;
    let text, cls = 'badge';
    if (!s) text = `AI: ${brainName(m.ai)} (configured, no call yet)`;
    else if (s.fellBack) { text = `AI: ${brainName(s.provider)} (${brainName(m.ai)} failed)`; cls += ' warn'; }
    else { text = `AI: ${brainName(s.provider)} ✓`; cls += ' ok'; }
    box.replaceChildren(
      el('span', { class: cls, title: s && s.error ? `Last error: ${s.error}` : 'AI brain that answered last' }, text),
      el('span', { class: 'badge', title: 'PayPal mode' }, `PayPal: ${m.paypal === 'sandbox' ? 'sandbox' : 'simulated'}`));
  } catch { /* ignore */ }
}
// "answered by gemini" / "answered by offline brain (gemini failed)" from a reply's guard object.
function providerLabel(guard, configured) {
  if (!guard || !guard.provider) return '';
  const who = brainName(guard.provider);
  return guard.fellBack ? `answered by ${who}${configured ? ` (${brainName(configured)} failed)` : ' (fell back)'}` : `answered by ${who}`;
}
let configuredAi = null;
api('/api/health').then((m) => { configuredAi = m.ai; }).catch(() => {});
const whoLabel = (guard) => el('small', { class: 'who' }, providerLabel(guard, configuredAi));

function chipsFor(guard, action) {
  const c = [];
  if (guard.injection) c.push(el('span', { class: 'chip bad' }, 'Manipulation attempt ignored'));
  if (guard.belowFloor) c.push(el('span', { class: 'chip guard' }, 'Offer below seller limit, refused'));
  if (guard.clamped) c.push(el('span', { class: 'chip guard' }, 'AI price corrected by guardrail'));
  if (guard.messageReplaced) c.push(el('span', { class: 'chip guard' }, 'AI reply replaced (unsafe wording)'));
  if (!c.length && action) c.push(el('span', { class: 'chip ok' }, 'Within seller limits'));
  return el('div', { class: 'chips' }, c);
}
// confetti on "deal closed" (canvas-confetti, vendored); skipped for reduced-motion users or if the library is missing
function celebrate() {
  if (!window.confetti || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  window.confetti({ particleCount: 110, spread: 75, origin: { y: 0.65 }, colors: ['#2563eb', '#15803d', '#c2410c', '#ffffff'] });
}
const typingBubble = () => el('div', { class: 'msg seller typing', 'aria-label': 'The assistant is typing', role: 'status' }, el('i'), el('i'), el('i'));
const statusPill = (s) => el('span', { class: `pill ${s}` }, s);
