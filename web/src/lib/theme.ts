import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark';
const KEY = 'haggle-theme';
const read = (): Mode | null => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; } };
const system = (): Mode => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const apply = (m: Mode) => document.documentElement.classList.toggle('dark', m === 'dark');

// Follows the system setting until the user picks one with the toggle (then it is remembered).
export function initTheme() { apply(read() ?? system()); }

export function useTheme() {
  const [mode, setMode] = useState<Mode>(() => read() ?? system());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (!read()) { const m = system(); setMode(m); apply(m); } };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const toggle = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    setMode(next); apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage may be blocked */ }
  };
  return { mode, toggle };
}
