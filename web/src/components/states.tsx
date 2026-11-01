import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

// One look for "nothing here", "that failed" and "still loading", so every page treats them the same way.
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-card px-4 py-12 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden>{icon}</div>}
      <h2 className="text-lg font-bold">{title}</h2>
      {children && <p className="mt-1 max-w-[46ch] text-mute">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-bad bg-bad-soft px-4 py-3 text-bad">
      {message}
      {onRetry && <button type="button" onClick={onRetry} className="ml-3 font-bold underline">Try again</button>}
    </div>
  );
}

export function Skeleton({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <div role="status" aria-label={label} className={cn('animate-pulse rounded-2xl border border-line bg-card', className ?? 'h-40')} />;
}

export function NotFound() {
  return (
    <EmptyState title="We could not find that page" action={<Link to="/" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 py-2.5 font-bold text-brand-ink no-underline">Back to the shop</Link>}>
      The link may be old or mistyped. The shop and your orders are one click away.
    </EmptyState>
  );
}
