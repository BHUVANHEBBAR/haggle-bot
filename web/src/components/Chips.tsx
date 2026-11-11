import type { Guard } from '../api/types';
import { cn } from '../lib/utils';

// What the guardrails did to this reply: refused, corrected, replaced, or "within seller limits".
export default function Chips({ guard, action }: { guard: Guard; action?: string }) {
  const c: { k: 'ok' | 'guard' | 'bad'; t: string }[] = [];
  if (guard.injection) c.push({ k: 'bad', t: 'Manipulation attempt ignored' });
  if (guard.offTopic) c.push({ k: 'guard', t: guard.offTopic === 'abuse' ? 'Abusive message, not answered' : 'Off-topic, not answered' });
  if (guard.belowFloor) c.push({ k: 'guard', t: 'Offer below seller limit, refused' });
  if (guard.clamped) c.push({ k: 'guard', t: 'AI price corrected by guardrail' });
  if (guard.messageReplaced) c.push({ k: 'guard', t: 'AI reply replaced (unsafe wording)' });
  if (!c.length && action) c.push({ k: 'ok', t: 'Within seller limits' });
  const tone = { ok: 'border-ok text-ok', guard: 'border-warn text-warn', bad: 'border-bad text-bad' };
  return (
    <div className="chips mt-1.5 flex flex-wrap gap-1.5">
      {c.map((x) => <span key={x.t} className={cn('chip rounded-full border bg-card px-2 py-0.5 text-xs font-semibold', x.k, tone[x.k])}>{x.t}</span>)}
    </div>
  );
}
