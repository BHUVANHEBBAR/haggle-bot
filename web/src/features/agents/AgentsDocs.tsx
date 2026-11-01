import { useState } from 'react';
import { Bot, Check, Copy, ExternalLink, FileJson, Handshake, Search, ShieldCheck, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '../../components/ui';

const origin = window.location.origin;

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-navy text-navy-ink">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-xs font-semibold text-navy-mute">
        {title}
        <button onClick={() => { void navigator.clipboard?.writeText(code); setDone(true); setTimeout(() => setDone(false), 1500); }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-white/10" aria-label={`Copy ${title}`}>
          {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{done ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre tabIndex={0} aria-label={`${title} example`} className="m-0 overflow-x-auto p-3 text-[13px] leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

const CURL = `# 1. discover  2. start  3. offer (cents)  4. checkout (a human approves the link)
curl ${origin}/.well-known/negotiate.json
curl -X POST ${origin}/api/agent/v1/sessions -H 'content-type: application/json' \\
  -d '{"product_id":"tote"}'
curl -X POST ${origin}/api/agent/v1/sessions/$SESSION/offers -H 'content-type: application/json' \\
  -d '{"unit_price_cents":3000}'
curl -X POST ${origin}/api/agent/v1/deals/$DEAL/checkout`;

const JS = `const base = '${origin}/api/agent/v1';
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

const s = await post('/sessions', { product_id: 'tote' });
let offer = Math.round(s.ask_cents * 0.6);          // your agent's strategy and secret budget live here
for (let i = 0; i < s.max_rounds; i++) {
  const r = await post(\`/sessions/\${s.session_id}/offers\`, { unit_price_cents: offer });
  if (r.status === 'accepted') { console.log(await post(\`/deals/\${r.deal.deal_id}/checkout\`, {})); break; } // hand approve_url to your human
  if (r.status === 'walked_away') break;
  offer = Math.min(r.price_cents, Math.round(offer * 1.12)); // meet the counter gradually
}`;

const PY = `import requests
base = "${origin}/api/agent/v1"
s = requests.post(f"{base}/sessions", json={"product_id": "tote"}).json()
r = requests.post(f"{base}/sessions/{s['session_id']}/offers", json={"unit_price_cents": 3000}).json()
print(r["status"], r["price_cents"], r["message"])`;

interface Product { id: string; name: string; list_price_cents: number }
type Log = { label: string; req?: unknown; res: unknown };

// Live console against the real endpoints: this is exactly what an external agent would send.
function TryIt() {
  const [products, setProducts] = useState<Product[]>([]);
  const [pid, setPid] = useState('tote');
  const [sid, setSid] = useState('');
  const [deal, setDeal] = useState('');
  const [cents, setCents] = useState('3000');
  const [log, setLog] = useState<Log[]>([]);
  const [approve, setApprove] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      setLog((l) => [{ label: `${method} ${path} -> ${res.status}`, req: body, res: json }, ...l]);
      return { ok: res.ok, json };
    } catch (e) { toast.error((e as Error).message); return { ok: false, json: null }; } finally { setBusy(false); }
  }
  async function load() {
    const r = await go('/api/agent/v1/products', 'GET');
    if (r.ok) setProducts((r.json as { products: Product[] }).products);
  }
  async function begin() {
    const r = await go('/api/agent/v1/sessions', 'POST', { product_id: pid });
    if (r.ok) { const j = r.json as { session_id: string; ask_cents: number }; setSid(j.session_id); setDeal(''); setApprove(''); setCents(String(Math.round(j.ask_cents * 0.6))); }
  }
  async function send() {
    const r = await go(`/api/agent/v1/sessions/${sid}/offers`, 'POST', { unit_price_cents: Number(cents) });
    if (r.ok) {
      const j = r.json as { status: string; price_cents: number; deal: { deal_id: string } | null };
      if (j.deal) setDeal(j.deal.deal_id); else if (j.status === 'counter') setCents(String(j.price_cents));
    }
  }
  async function checkout() {
    const r = await go(`/api/agent/v1/deals/${deal}/checkout`, 'POST', {});
    if (r.ok) setApprove((r.json as { approve_url: string }).approve_url);
  }
  const field = 'min-h-11 rounded-xl border border-line bg-card px-3 py-2 text-ink';
  return (
    <Card id="tryit">
      <h2 className="mb-1 mt-0 flex items-center gap-2 text-lg font-semibold"><Bot size={18} aria-hidden /> Try it live</h2>
      <p className="mb-3 text-sm text-mute">These buttons call the same public endpoints an external agent would. Start a session, make structured offers in cents, and watch the counters.</p>
      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-sm font-semibold">Product
          <select className={field} value={pid} onChange={(e) => setPid(e.target.value)} onFocus={() => { if (!products.length) void load(); }}>
            {(products.length ? products : [{ id: 'tote', name: 'Handwoven Block-Print Tote', list_price_cents: 4800 }, { id: 'lamp', name: 'Vintage Brass Desk Lamp', list_price_cents: 12000 }, { id: 'logo', name: 'Logo Design Package', list_price_cents: 30000 }])
              .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <Button id="agentStart" disabled={busy} onClick={() => void begin()}>1. Start session</Button>
        <label className="flex flex-col gap-1 text-sm font-semibold">Offer (unit price, cents)
          <input className={`${field} w-36`} inputMode="numeric" value={cents} onChange={(e) => setCents(e.target.value)} aria-label="Offer in cents" />
        </label>
        <Button id="agentOffer" variant="ghost" disabled={busy || !sid || !!deal} onClick={() => void send()}>2. Send offer</Button>
        <Button id="agentCheckout" variant="success" disabled={busy || !deal} onClick={() => void checkout()}>3. Create PayPal link</Button>
      </div>
      {approve && (
        <div className="mb-3 rounded-xl border border-ok bg-ok-soft p-3 text-sm text-ok">
          A human approves the payment here (sandbox): <a id="approveLink" className="inline-flex items-center gap-1 font-bold underline" href={approve} target="_blank" rel="noreferrer">open approval page <ExternalLink size={14} aria-hidden /></a>
        </div>
      )}
      <div id="agentLog" tabIndex={0} role="log" aria-label="API responses" className="flex max-h-[420px] flex-col gap-2 overflow-auto">
        {log.length === 0 && <div className="text-sm text-mute">Responses appear here.</div>}
        {log.map((l, i) => (
          <div key={log.length - i} className="min-w-0 rounded-xl bg-chip p-2.5">
            <div className="text-xs font-bold text-mute">{l.label}</div>
            {l.req !== undefined && <pre tabIndex={0} aria-label="Request body" className="m-0 overflow-x-auto text-xs">{JSON.stringify(l.req)}</pre>}
            <pre tabIndex={0} aria-label="Response body" className="m-0 overflow-x-auto text-xs">{JSON.stringify(l.res, null, 2)}</pre>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AgentsDocs() {
  const steps = [
    { icon: Search, t: '1. Discover', d: 'GET /.well-known/negotiate.json lists the endpoints, limits and products.' },
    { icon: Handshake, t: '2. Negotiate', d: 'POST structured offers in integer cents. Get a counter, an acceptance, or a walk-away.' },
    { icon: ShieldCheck, t: '3. Guaranteed limits', d: 'Plain code enforces the seller floor. The AI only words replies. Prompt injection in the note field changes nothing.' },
    { icon: Wallet, t: '4. Human pays', d: 'Create a PayPal order from the stored deal and give the approval link to your human.' },
  ];
  return (
    <>
      <h1 className="mb-2 mt-2 text-[clamp(26px,5vw,38px)] font-extrabold leading-[1.15] tracking-tight">Connect your shopper agent</h1>
      <p className="mb-5 max-w-[68ch] text-mute">
        An open, documented negotiation API for AI agents. Unlike prose-only protocols, offers and counters are explicit fields, and the flow ends in a real PayPal checkout.
        No API key, sandbox money only, rate-limited per IP.
      </p>
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-3">
        {steps.map(({ icon: I, t, d }) => (
          <Card key={t} className="flex flex-col gap-1.5">
            <div className="grid size-9 place-items-center rounded-[10px] bg-brand-soft text-brand"><I size={18} aria-hidden /></div>
            <strong>{t}</strong><span className="text-sm text-mute">{d}</span>
          </Card>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2.5">
        <a className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-chip px-4 py-2 font-bold text-ink no-underline hover:bg-brand-soft" href="/.well-known/negotiate.json" target="_blank" rel="noreferrer"><FileJson size={16} aria-hidden /> Descriptor</a>
        <a className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-chip px-4 py-2 font-bold text-ink no-underline hover:bg-brand-soft" href="/api/agent/v1/openapi.json" target="_blank" rel="noreferrer"><FileJson size={16} aria-hidden /> OpenAPI 3.1</a>
        <a className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-chip px-4 py-2 font-bold text-ink no-underline hover:bg-brand-soft" href="/docs/haggle-bot.postman_collection.json" download><FileJson size={16} aria-hidden /> Postman collection</a>
      </div>
      <TryIt />
      <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Code samples</h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CodeBlock title="curl" code={CURL} />
        <CodeBlock title="JavaScript" code={JS} />
        <CodeBlock title="Python" code={PY} />
      </div>
    </>
  );
}
