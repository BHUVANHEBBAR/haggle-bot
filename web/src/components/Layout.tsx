import { NavLink, Outlet } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useHealth } from '../hooks/useHealth';
import { useTheme } from '../lib/theme';
import { brainName, cn } from '../lib/utils';

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-[26px] shrink-0" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="8" fill="#2563eb" />
      <path d="M9 20.5l5.2-5.2 3 3L23 12.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23" cy="12.5" r="2" fill="#fdba74" />
    </svg>
  );
}

// Header badges reflect the last real AI call, not just the configuration.
function Badges() {
  const { data: h } = useHealth();
  if (!h) return <div id="badges" className="flex flex-wrap gap-1.5" />;
  const s = h.aiStatus;
  let text: string; let tone = '';
  if (!s) text = `AI: ${brainName(h.ai)} (configured, no call yet)`;
  else if (s.fellBack) { text = `AI: ${brainName(s.provider)} (${brainName(h.ai)} failed)`; tone = 'text-amber-300 border-amber-300/50'; }
  else { text = `AI: ${brainName(s.provider)} ✓`; tone = 'text-green-300 border-green-300/50'; }
  const base = 'badge whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-navy-mute';
  return (
    <div id="badges" className="flex flex-wrap gap-1.5">
      <span className={cn(base, tone)} title={s?.error ? `Last error: ${s.error}` : 'AI brain that answered last'}>{text}</span>
      <span className={base} title="PayPal mode">PayPal: {h.paypal === 'sandbox' ? 'sandbox' : 'simulated'}</span>
    </div>
  );
}

const link = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-full px-3 py-1.5 text-[15px] font-semibold no-underline', isActive ? 'bg-white/15 text-white' : 'text-navy-mute hover:bg-white/10 hover:text-white');

export default function Layout() {
  const { mode, toggle } = useTheme();
  return (
    <>
      <header className="top sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 bg-navy px-5 py-3 text-navy-ink">
        <NavLink to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-white no-underline" aria-label="HaggleBot home">
          <Logo /><span>Haggle<span className="text-[#7fa8ff]">Bot</span></span>
        </NavLink>
        <nav aria-label="Main" className="order-3 flex w-full flex-wrap gap-1 sm:order-none sm:w-auto sm:flex-1">
          <NavLink to="/" end className={link}>Shop</NavLink>
          <NavLink to="/battle" className={link}>Agent vs agent</NavLink>
          <NavLink to="/seller" className={link}>Seller dashboard</NavLink>
          <NavLink to="/agents" className={link}>For agents</NavLink>
        </nav>
        <Badges />
        <button onClick={toggle} aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="inline-flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-white">
          {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>
      <main className="mx-auto max-w-[1120px] px-4 pb-10 pt-6">
        <Outlet />
      </main>
      <footer className="no-print mx-auto max-w-[1120px] px-4 pb-10 text-[13px] text-mute">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-5">
          <span>HaggleBot is a demo store built for the PayPal AI Hackathon. Sandbox payments only: no real money moves. Prices in USD.</span>
          <span className="flex gap-4"><NavLink to="/agents" className="text-mute underline">API for agents</NavLink><NavLink to="/battle" className="text-mute underline">Red-team demo</NavLink></span>
        </div>
      </footer>
    </>
  );
}
