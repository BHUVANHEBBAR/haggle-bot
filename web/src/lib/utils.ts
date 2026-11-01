import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import confetti from 'canvas-confetti';
import type { Guard } from '../api/types';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// The AI brain's display name ("mock" is the scripted offline brain).
export const brainName = (p: string) => (p === 'mock' || p === 'none' ? 'offline brain' : p === 'compat' ? 'alternate model' : p === 'code' ? 'the shop rules (no AI)' : p);

// "answered by gemini" / "answered by offline brain (gemini failed)" from a reply's guard object.
export function providerLabel(guard: Guard | undefined, configured: string | null): string {
  if (!guard || !guard.provider) return '';
  const who = brainName(guard.provider);
  if (!guard.fellBack) return `answered by ${who}`;
  return `answered by ${who}${configured ? ` (${brainName(configured)} failed)` : ' (fell back)'}`;
}

// Confetti on "deal closed"; skipped for reduced-motion users.
export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  void confetti({ particleCount: 110, spread: 75, origin: { y: 0.65 }, colors: ['#2563eb', '#15803d', '#c2410c', '#ffffff'] });
}

export function fmtLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
