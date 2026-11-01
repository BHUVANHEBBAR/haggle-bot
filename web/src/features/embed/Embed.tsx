import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { ChatStart, Product } from '../../api/types';
import { Button } from '../../components/ui';
import ChatRoom from '../shop/ChatRoom';

// Chrome-less negotiation, loaded inside the host page's iframe by /embed.js.
// Results go to the host with postMessage; the price itself never leaves the server.
export default function Embed() {
  const [params] = useSearchParams();
  const wanted = params.get('product') || '';
  const [room, setRoom] = useState<{ product: Product; session: ChatStart } | null>(null);
  const [error, setError] = useState('');

  async function begin(id: string) {
    try {
      const { products } = await api<{ products: Product[] }>('/api/products');
      const p = products.find((x) => x.id === id) ?? products[0];
      if (!p) throw new Error('No products yet');
      const session = await api<ChatStart>('/api/chat/start', { method: 'POST', body: { productId: p.id } });
      setRoom({ product: p, session });
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void begin(wanted); }, [wanted]);

  // Tell the host page when a deal closes (it can show its own confirmation).
  useEffect(() => {
    const t = setInterval(() => {
      const pay = document.getElementById('pay');
      if (pay && window.parent !== window && !(window as unknown as { __sent?: boolean }).__sent) {
        (window as unknown as { __sent?: boolean }).__sent = true;
        window.parent.postMessage({ source: 'haggle', type: 'deal', detail: { product: room?.product.id, status: 'agreed' } }, '*');
      }
    }, 500);
    return () => clearInterval(t);
  }, [room]);

  if (error) return <div className="p-4 text-sm text-bad">{error}</div>;
  if (!room) return <div className="p-4 text-sm text-mute">Loading...</div>;
  return (
    <div className="p-3">
      <ChatRoom product={room.product} session={room.session} onBack={() => void begin(wanted)} embedded />
      <div className="mt-2 text-center"><Button variant="ghost" className="min-h-9 px-3 py-1 text-xs" onClick={() => void begin(wanted)}>Start over</Button></div>
    </div>
  );
}
