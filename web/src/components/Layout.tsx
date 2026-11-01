import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun, User, X } from 'lucide-react';
import { useHealth } from '../hooks/useHealth';
import { useTheme } from '../lib/theme';
import { brainName, cn } from '../lib/utils';
import { useBuyer, useSignOut } from '../features/buyer/api';
import SignInDialog from '../features/buyer/SignInDialog';

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
    <div id="badges" className="hidden flex-wrap gap-1.5 md:flex">
      <span className={cn(base, tone)} title={s?.error ? `Last error: ${s.error}` : 'AI brain that answered last'}>{text}</span>
      <span className={base} title="PayPal mode">PayPal: {h.paypal === 'sandbox' ? 'sandbox' : 'simulated'}</span>
    </div>
  );
}

const link = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-full px-3 py-2 text-[15px] font-semibold no-underline', isActive ? 'bg-white/15 text-white' : 'text-navy-mute hover:bg-white/10 hover:text-white');

function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-white">
      {mode === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

function Brand({ suffix }: { suffix?: string }) {
  return (
    <NavLink to={suffix ? '/seller' : '/'} className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-white no-underline" aria-label={suffix ? undefined : 'HaggleBot home'}>
      <Logo /><span>Haggle<span className="text-[#7fa8ff]">Bot</span></span>
      {suffix && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">{suffix}</span>}
    </NavLink>
  );
}

// The seller works in their own console: no shop navigation, a clear way back to the storefront.
function ConsoleHeader() {
  return (
    <header className="top sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 bg-navy px-5 py-3 text-navy-ink">
      <Brand suffix="Seller console" />
      <nav aria-label="Seller" className="order-3 w-full sm:order-none sm:w-auto sm:flex-1"><Link to="/" className="inline-block rounded-full px-3 py-2 text-[15px] font-semibold text-navy-mute no-underline hover:bg-white/10 hover:text-white">View shop as a buyer</Link></nav>
      <Badges />
      <div className="ml-auto sm:ml-0"><ThemeToggle /></div>
    </header>
  );
}

function ShopHeader({ onSignIn }: { onSignIn: () => void }) {
  const { data: buyer } = useBuyer();
  const signOut = useSignOut();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [pathname]);

  return (
    <header className="top sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 bg-navy px-5 py-3 text-navy-ink">
      <Brand />
      <nav id="main-nav" aria-label="Main" className={cn('order-3 w-full flex-wrap items-center gap-1 sm:order-none sm:flex sm:w-auto sm:flex-1', menu ? 'flex' : 'hidden')}>
        <NavLink to="/" end className={link}>Shop</NavLink>
        <NavLink to="/orders" className={link}>My orders</NavLink>
        <details className="group relative">
          <summary className="cursor-pointer list-none rounded-full px-3 py-2 text-[15px] font-semibold text-navy-mute hover:bg-white/10 hover:text-white">Developers</summary>
          <div className="z-30 mt-1 flex min-w-[200px] flex-col rounded-xl border border-line bg-card p-1 shadow-card sm:absolute">
            <NavLink to="/battle" className="rounded-lg px-3 py-2.5 font-semibold text-ink no-underline hover:bg-chip">Agent vs agent</NavLink>
            <NavLink to="/agents" className="rounded-lg px-3 py-2.5 font-semibold text-ink no-underline hover:bg-chip">API for agents</NavLink>
          </div>
        </details>
      </nav>
      <Badges />
      <div className="ml-auto flex items-center gap-2 sm:ml-0">
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white sm:hidden" aria-expanded={menu} aria-controls="main-nav" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu(!menu)}>
        {menu ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      </button>
      {buyer?.signedIn ? (
        <div className="flex items-center gap-1.5 text-sm text-white" aria-label="Account">
          <span className="hidden max-w-[160px] truncate sm:inline" title={buyer.email}>{buyer.email}</span>
          <button type="button" aria-label="Sign out" onClick={() => void signOut()} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 font-semibold hover:bg-white/20"><LogOut size={16} aria-hidden /><span className="hidden sm:inline">Sign out</span></button>
        </div>
      ) : (
        <button type="button" aria-label="Sign in" onClick={onSignIn} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 font-semibold text-white hover:bg-white/20 sm:px-3.5"><User size={16} aria-hidden /><span className="hidden sm:inline">Sign in</span></button>
      )}
      <ThemeToggle />
      </div>
    </header>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  const [signIn, setSignIn] = useState(false);
  const consoleMode = pathname.startsWith('/seller');
  return (
    <>
      <a href="#main" className="sr-focus">Skip to main content</a>
      {consoleMode ? <ConsoleHeader /> : <ShopHeader onSignIn={() => setSignIn(true)} />}
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1120px] px-4 pb-10 pt-6">
        <Outlet />
      </main>
      <footer className="no-print mx-auto max-w-[1120px] px-4 pb-10 text-[13px] text-mute">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-5">
          <span>HaggleBot is a demo store built for the PayPal AI Hackathon. Sandbox payments only: no real money moves. Prices in USD.</span>
          <span className="flex gap-4">
            {consoleMode ? <NavLink to="/" className="text-mute underline">Back to the shop</NavLink> : <NavLink to="/seller" className="text-mute underline">Seller sign-in</NavLink>}
            <NavLink to="/agents" className="text-mute underline">API for agents</NavLink><NavLink to="/battle" className="text-mute underline">Red-team demo</NavLink>
          </span>
        </div>
      </footer>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} />
    </>
  );
}
