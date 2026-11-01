import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button, Notice } from '../../components/ui';
import { startSignIn, verifySignIn, type BuyerState } from './api';

// Email + one-time code. No mail service is connected (sandbox demo), so the server returns the code and we show it,
// clearly labelled. Native <dialog>: focus trap and Esc come for free.
export default function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) { setStep('email'); setCode(''); setErr(''); setDemoCode(undefined); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await startSignIn(email); setDemoCode(r.demoCode); setStep('code'); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await verifySignIn(email, code);
      qc.setQueryData<BuyerState>(['buyer'], { signedIn: true, email: r.email });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  const input = 'mt-1 min-h-11 w-full rounded-xl border border-line bg-card px-3 py-2.5';
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="signin-title" className="m-auto w-[min(440px,calc(100%-32px))] rounded-2xl border border-line bg-card p-0 text-ink shadow-card backdrop:bg-black/50">
      <div className="p-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id="signin-title" className="text-xl font-extrabold tracking-tight">{step === 'email' ? 'Sign in to see your orders' : 'Enter your code'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-chip"><X size={16} aria-hidden /></button>
        </div>
        <p className="mb-4 text-sm text-mute">{step === 'email' ? 'Optional. You can always buy as a guest. Signing in keeps your orders together.' : <>We made a 6-digit code for <b>{email}</b>.</>}</p>

        {step === 'email' ? (
          <form onSubmit={sendCode}>
            <label htmlFor="buyerEmail" className="block text-[13px] font-bold">Email</label>
            <input id="buyerEmail" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={input} aria-describedby="buyerErr" />
            <div id="buyerErr" role="alert" className="mt-2 min-h-5 text-[13px] text-bad">{err}</div>
            <Button className="mt-2 w-full" disabled={busy}>{busy ? 'Sending...' : 'Send me a code'}</Button>
          </form>
        ) : (
          <form onSubmit={verify}>
            {demoCode && <Notice kind="info"><b>Demo mode:</b> no email is sent in this sandbox. Your code is <span className="num text-lg font-extrabold tracking-widest" data-testid="demo-code">{demoCode}</span></Notice>}
            <label htmlFor="buyerCode" className="block text-[13px] font-bold">6-digit code</label>
            <input id="buyerCode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={input} aria-describedby="buyerErr" />
            <div id="buyerErr" role="alert" className="mt-2 min-h-5 text-[13px] text-bad">{err}</div>
            <Button className="mt-2 w-full" disabled={busy || code.length !== 6}>{busy ? 'Checking...' : 'Sign in'}</Button>
            <button type="button" onClick={() => { setStep('email'); setErr(''); }} className="mt-3 w-full text-sm font-semibold text-brand underline">Use a different email</button>
          </form>
        )}
      </div>
    </dialog>
  );
}
