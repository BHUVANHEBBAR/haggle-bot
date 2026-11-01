import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Check, Send, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, Card } from '../../components/ui';
import { cn } from '../../lib/utils';
import { headers } from './api';

interface ToolCall { tool: string; args: Record<string, unknown>; transport: 'mcp' | 'rest' | 'local'; ok: boolean; ms: number; debugId: string | null; error: string | null; preview: string | null; untrusted: boolean }
interface Proposal { id: string; action: string; dealId: string; summary: string; objectIds: Record<string, string | undefined>; status: string; tainted: boolean; reason: string; expiresAt: string }
interface Turn { role: 'seller' | 'copilot'; text: string; calls?: ToolCall[]; proposals?: Proposal[]; llm?: string }
interface Status { mode: 'sandbox' | 'simulated'; tools: { name: string; kind: string; mcp: string | null }[]; mcp: { connected: boolean; tools: number; executes: boolean; error: string | null } | null; proposals: Proposal[] }

const label: Record<string, string> = { create_refund: 'Refund', capture_authorization: 'Capture', void_authorization: 'Release hold' };
const transportTone: Record<string, string> = { mcp: 'bg-brand-soft text-[#1e40af] dark:text-brand', rest: 'bg-chip text-ink', local: 'bg-chip text-mute' };
const SUGGESTIONS = ['Does PayPal confirm my sales?', 'Refund the last tote deal', 'Do I have any disputes?', 'Show my recent PayPal transactions'];

// A copilot whose tools are PayPal actions. Reads run now (shown below each answer); money actions are only PROPOSED.
export default function Copilot({ sellerKey, onChanged }: { sellerKey: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: status } = useQuery({ queryKey: ['copilot-status', sellerKey], queryFn: () => api<Status>('/api/seller/copilot/status', { headers: headers(sellerKey) }), staleTime: 30_000 });
  const { data: pending } = useQuery({ queryKey: ['proposals', sellerKey], queryFn: () => api<{ proposals: Proposal[] }>('/api/seller/copilot/proposals', { headers: headers(sellerKey) }), refetchInterval: 15_000 });

  async function send(raw: string) {
    const q = raw.trim(); if (!q || busy) return;
    setBusy(true); setText('');
    const history = turns.slice(-6).map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'seller', text: q }]);
    try {
      const r = await api<{ reply: string; toolCalls: ToolCall[]; proposals: Proposal[]; llm: { provider: string; fellBack: boolean } | null }>('/api/seller/copilot', { method: 'POST', headers: headers(sellerKey), body: { message: q, history } });
      setTurns((t) => [...t, { role: 'copilot', text: r.reply, calls: r.toolCalls, proposals: r.proposals, llm: r.llm ? `${r.llm.provider === 'mock' ? 'offline brain' : r.llm.provider}${r.llm.fellBack ? ' (fallback)' : ''}` : undefined }]);
      void qc.invalidateQueries({ queryKey: ['proposals'] });
    } catch (e) { setTurns((t) => [...t, { role: 'copilot', text: (e as Error).message }]); }
    setBusy(false);
  }

  async function decide(p: Proposal, what: 'confirm' | 'reject') {
    try {
      await api(`/api/seller/copilot/proposals/${p.id}/${what}`, { method: 'POST', headers: headers(sellerKey), body: {} });
      toast.success(what === 'confirm' ? `${label[p.action]} done through PayPal` : 'Proposal rejected');
      setTurns((t) => t.map((x) => ({ ...x, proposals: x.proposals?.map((y) => (y.id === p.id ? { ...y, status: what === 'confirm' ? 'confirmed' : 'rejected' } : y)) })));
      void qc.invalidateQueries({ queryKey: ['proposals'] });
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
  }

  const waiting = (pending?.proposals ?? []).filter((p) => !turns.some((t) => t.proposals?.some((y) => y.id === p.id)));
  const mcp = status?.mcp;

  const ProposalCard = ({ p }: { p: Proposal }) => (
    <div className={cn('proposal mt-2 rounded-xl border p-3 text-sm', p.status === 'pending' ? 'border-warn bg-warn-soft' : 'border-line bg-chip')} data-testid="proposal">
      <div className="flex flex-wrap items-center gap-2 font-bold"><ShieldAlert size={16} aria-hidden /> Proposed: {label[p.action] ?? p.action}
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-mute">{p.status}</span></div>
      <p className="my-1">{p.summary}</p>
      <div className="num text-xs text-mute">{Object.entries(p.objectIds).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
      {p.tainted && <div className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-bad"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />Created after the assistant read buyer chat text. Check it is what YOU want before confirming.</div>}
      {p.status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <Button variant="success" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => void decide(p, 'confirm')}><Check size={14} aria-hidden /> Confirm {label[p.action]?.toLowerCase()}</Button>
          <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => void decide(p, 'reject')}><X size={14} aria-hidden /> Reject</Button>
        </div>
      )}
    </div>
  );

  return (
    <Card id="copilot" className="mb-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong className="inline-flex items-center gap-2"><Bot size={18} aria-hidden /> Seller Copilot, with PayPal tools</strong>
          <div className="text-[13px] text-mute">Ask about your PayPal payments. Lookups run immediately; refunds, captures and releases are only <b>proposed</b> and need your Confirm click.</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold" id="copilotStatus">
          <span className="rounded-full bg-chip px-2 py-0.5">{status?.mode === 'sandbox' ? 'live PayPal sandbox' : 'simulated PayPal'}</span>
          {mcp ? (
            <span className="rounded-full bg-chip px-2 py-0.5" title={mcp.error ?? ''}>PayPal MCP: {mcp.connected ? `${mcp.tools} tools found` : 'not connected'}{mcp.connected ? (mcp.executes ? ', executing' : ', execution blocked on PayPal\'s side, using REST') : ''}</span>
          ) : <span className="rounded-full bg-chip px-2 py-0.5">tools via PayPal REST API</span>}
        </div>
      </div>

      {waiting.length > 0 && <div id="waiting" className="mb-2"><div className="text-xs font-bold uppercase tracking-wider text-mute">Waiting for your decision</div>{waiting.map((p) => <ProposalCard key={p.id} p={p} />)}</div>}

      <div id="copilotLog" role="log" aria-label="Copilot conversation" tabIndex={0} className="flex max-h-[460px] flex-col gap-2 overflow-auto rounded-xl bg-chip/50 p-2">
        {turns.length === 0 && <div className="p-2 text-sm text-mute">Try one of the suggestions below.</div>}
        {turns.map((t, i) => (
          <div key={i} className={cn('max-w-[94%] rounded-2xl px-3 py-2 text-sm', t.role === 'seller' ? 'self-end bg-brand text-brand-ink' : 'self-start bg-card')}>
            <div className="whitespace-pre-wrap break-words">{t.text}</div>
            {t.calls && t.calls.length > 0 && (
              <ul className="toolcalls mt-2 list-none space-y-1 p-0" aria-label="PayPal tool calls">
                {t.calls.map((c, j) => (
                  <li key={j} className="toolcall rounded-lg border border-line bg-bg px-2 py-1 text-xs">
                    <span className="font-bold">{c.tool}</span>
                    <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 font-semibold', transportTone[c.transport])}>{c.transport}</span>
                    {c.untrusted && <span className="ml-1 rounded-full bg-bad-soft px-1.5 py-0.5 font-semibold text-bad">untrusted buyer text</span>}
                    <span className="num ml-1.5 text-mute">{c.ms} ms{c.debugId ? ` · PayPal debug_id ${c.debugId}` : ''}</span>
                    <div className="num break-all text-mute">{JSON.stringify(c.args)}{c.ok ? ` -> ${c.preview}` : ` -> ERROR ${c.error}`}</div>
                  </li>
                ))}
              </ul>
            )}
            {t.proposals?.map((p) => <ProposalCard key={p.id} p={p} />)}
            {t.llm && <div className="mt-1 text-[11px] text-mute">answered by {t.llm}</div>}
          </div>
        ))}
        {busy && <div className="self-start rounded-2xl bg-card px-3 py-2 text-sm text-mute" role="status">Asking PayPal...</div>}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => void send(s)} disabled={busy} className="rounded-full bg-chip px-3 py-1 text-xs font-semibold hover:bg-brand-soft disabled:opacity-50">{s}</button>)}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label className="sr" htmlFor="copilotInput">Ask the copilot</label>
        <input id="copilotInput" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ask about your PayPal payments..." className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-base" />
        <Button id="copilotSend" disabled={busy || !text.trim()}><Send size={16} aria-hidden /> Ask</Button>
      </form>
    </Card>
  );
}
