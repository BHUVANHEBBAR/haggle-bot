import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Radio } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../../components/ui';
import { usd } from '../../lib/utils';
import { describeEvent, headers, type SellerEvent } from './api';

// Reads /api/seller/stream (server-sent events) with fetch, so the seller key stays in a header, not a URL.
export function useLiveFeed(sellerKey: string) {
  const [items, setItems] = useState<SellerEvent[]>([]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    (async () => {
      let delay = 1000;
      while (!stopped) {
        try {
          const res = await fetch('/api/seller/stream', { headers: headers(sellerKey), signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          setLive(true); delay = 1000;
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
              const line = chunk.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;
              const evt = JSON.parse(line.slice(6)) as SellerEvent;
              setItems((p) => [evt, ...p].slice(0, 8));
              if (evt.type === 'deal_agreed') toast.success(`New deal agreed: ${String(evt.productName)} for ${usd(Number(evt.totalCents))}`);
            }
          }
        } catch { /* aborted or offline: retry below */ }
        setLive(false);
        if (stopped) return;
        await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 15000);
      }
    })();
    return () => { stopped = true; ctrl.abort(); };
  }, [sellerKey]);
  return { items, live };
}

export default function LiveFeed({ sellerKey }: { sellerKey: string }) {
  const { items, live } = useLiveFeed(sellerKey);
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  return (
    <Card id="liveFeed" className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <strong className="inline-flex items-center gap-2"><Radio size={18} aria-hidden /> Live activity</strong>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${live ? 'bg-ok-soft text-[#166534] dark:text-ok' : 'bg-chip text-mute'}`}>
          <i className={`size-2 rounded-full ${live ? 'animate-pulse bg-ok' : 'bg-mute'}`} />{live ? 'live' : 'reconnecting'}
        </span>
      </div>
      {items.length === 0 ? <div className="text-[13px] text-mute">Waiting for buyers. Deals and guardrail events appear here the moment they happen.</div> : (
        <ul className="m-0 list-none p-0">
          <AnimatePresence initial={false}>
            {items.map((e) => (
              <motion.li key={e.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="break-words border-b border-line py-1.5 text-sm last:border-0">
                <span className="num mr-2 text-xs text-mute">{new Date(e.ts).toLocaleTimeString()}</span>
                {e.type === 'deal_agreed' ? <b className="text-ok">New deal: {String(e.productName)} for {usd(Number(e.totalCents))}</b> : describeEvent(e)}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}
