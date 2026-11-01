import { useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import type { SellerProduct } from './api';

// One snippet puts the haggle chat on any website. The host page cannot set a price: it lives on this server.
export default function EmbedSnippet({ products }: { products: SellerProduct[] }) {
  const [pid, setPid] = useState(products[0]?.id ?? 'tote');
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${window.location.origin}/embed.js" data-product="${pid}" async></script>`;
  return (
    <Card id="embedCard">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <strong className="inline-flex items-center gap-2"><Code2 size={18} aria-hidden /> Put haggling on your own website</strong>
        <label className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold">Product
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="min-h-11 min-w-0 max-w-full rounded-xl border border-line bg-card px-3 py-2">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <p className="mb-2 text-[13px] text-mute">Paste this before the closing body tag. Buyers get a floating chat button; your limits stay enforced on this server. Listen for results with <code>window.addEventListener('haggle:deal', ...)</code>.</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <pre tabIndex={0} aria-label="Embed snippet" className="m-0 min-w-0 flex-1 overflow-x-auto rounded-xl bg-navy p-3 text-[13px] text-navy-ink"><code>{snippet}</code></pre>
        <Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Card>
  );
}
