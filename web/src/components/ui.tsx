import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { cn } from '../lib/utils';
import type { DealStatus } from '../api/types';

type Variant = 'primary' | 'ghost' | 'success' | 'warn';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-hover',
  ghost: 'bg-chip text-ink hover:bg-brand-soft',
  success: 'bg-ok text-white hover:brightness-110 dark:text-[#04210f]',
  warn: 'bg-accent text-white hover:brightness-110',
};

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-[18px] py-2.5 font-bold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50', variants[variant], className)}
      {...p}
    />
  );
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 rounded-2xl border border-line bg-card p-[18px] shadow-card', className)} {...p} />;
}

const pill: Record<string, string> = {
  agreed: 'bg-brand-soft text-[#1e40af] dark:text-brand', order_created: 'bg-brand-soft text-[#1e40af] dark:text-brand', authorized: 'bg-warn-soft text-warn',
  captured: 'bg-ok-soft text-[#166534] dark:text-ok', refunded: 'bg-[#efe6fb] text-[#6b21a8] dark:bg-[#2a1a45] dark:text-[#d8b4fe]',
  voided: 'bg-chip text-mute', expired: 'bg-chip text-mute', invoiced: 'bg-warn-soft text-warn',
};
export function StatusPill({ status, label }: { status: DealStatus | string; label?: string }) {
  return <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-bold num', pill[status] || 'bg-chip text-mute')}>{label ?? status}</span>;
}

export function Notice({ kind, children }: { kind: 'ok' | 'bad' | 'info' | 'warn'; children: React.ReactNode }) {
  const k = { ok: 'border-ok bg-ok-soft text-ok', bad: 'border-bad bg-bad-soft text-bad', info: 'border-brand bg-brand-soft text-ink', warn: 'border-warn bg-warn-soft text-warn' }[kind];
  return <div className={cn('notice mb-4 rounded-xl border px-3.5 py-3', kind, k)}>{children}</div>;
}
