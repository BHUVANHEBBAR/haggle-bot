import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, Card, StatusPill } from '../../components/ui';
import { headers, type EvalReport } from './api';

// Hostile buyers + a deliberately misbehaving AI thrown at the real guardrails (src/eval.js, run in a child process).
export default function SafetyCheck({ sellerKey }: { sellerKey: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const { data } = useQuery({ queryKey: ['eval', sellerKey], queryFn: () => api<{ report: EvalReport | null }>('/api/seller/eval', { headers: headers(sellerKey) }) });
  const report = data?.report ?? null;

  async function run() {
    setRunning(true);
    try {
      const r = await api<{ report: EvalReport }>('/api/seller/eval/run', { method: 'POST', headers: headers(sellerKey), body: { n: 400 } });
      qc.setQueryData(['eval', sellerKey], r);
    } catch (e) { toast.error((e as Error).message); }
    setRunning(false);
  }

  const btn = <Button id="runEval" variant="ghost" disabled={running} onClick={() => void run()}>{running ? 'Running...' : report ? 'Run again' : 'Run safety check'}</Button>;
  return (
    <Card id="evalCard" className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {report ? (
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusPill status={report.passed ? 'captured' : 'refunded'} label={report.passed ? 'passed' : 'FAILED'} />
              <strong>{report.negotiations} simulated negotiations, {report.violationCount} rule violations</strong>
            </div>
            <div className="text-[13px] text-mute">
              {report.turns} buyer messages, {report.dealsClosed} deals closed, none below your floor. Guardrails stepped in {report.interventions.priceClamped} times on prices,{' '}
              {report.interventions.messageReplaced} on AI wording, blocked {report.interventions.injectionBlocked} manipulation attempts. Run {new Date(report.generatedAt).toLocaleString()}.
            </div>
          </div>
        ) : (
          <div>
            <strong className="inline-flex items-center gap-2"><ShieldCheck size={18} aria-hidden /> Safety check</strong>
            <div className="text-[13px] text-mute">Throws hundreds of hostile buyers and a deliberately misbehaving AI at the guardrails. Not run yet.</div>
          </div>
        )}
        {btn}
      </div>
    </Card>
  );
}
