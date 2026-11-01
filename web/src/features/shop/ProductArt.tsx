import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Original inline-SVG product illustrations (no external images, so the app stays self-contained and offline).
const art: Record<string, { bg: string; svg: ReactNode }> = {
  tote: {
    bg: 'from-[#fde7d0] to-[#f8c9a0] dark:from-[#3a2616] dark:to-[#51331c]',
    svg: (
      <>
        <path d="M58 70c0-26 8-40 22-40s22 14 22 40" fill="none" stroke="#9a3412" strokeWidth="5" strokeLinecap="round" />
        <path d="M44 66h72l8 68a8 8 0 0 1-8 9H44a8 8 0 0 1-8-9z" fill="#fff7ed" stroke="#9a3412" strokeWidth="3" strokeLinejoin="round" />
        {[[62, 90], [80, 84], [98, 92], [70, 112], [90, 110], [108, 116], [58, 128], [80, 130], [100, 130]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${i * 40})`}>
            <path d="M0 -7c5 3 5 10 0 14c-5-4-5-11 0-14z" fill={i % 2 ? '#c2410c' : '#0f766e'} opacity="0.85" />
          </g>
        ))}
      </>
    ),
  },
  lamp: {
    bg: 'from-[#fdf3c8] to-[#f3d98a] dark:from-[#352d10] dark:to-[#4a3d16]',
    svg: (
      <>
        <ellipse cx="80" cy="140" rx="34" ry="8" fill="#92400e" opacity="0.9" />
        <path d="M80 138V92l-26-26" fill="none" stroke="#b45309" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M30 70l30-42 32 22-18 40z" fill="#d97706" stroke="#92400e" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="56" cy="62" r="9" fill="#fef08a" />
        <path d="M44 74l-14 24M58 80l-6 28M70 74l8 26" stroke="#fde047" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      </>
    ),
  },
  logo: {
    bg: 'from-[#dbeafe] to-[#bfdbfe] dark:from-[#14264a] dark:to-[#1c3a70]',
    svg: (
      <>
        <rect x="34" y="34" width="92" height="92" rx="14" fill="#ffffff" stroke="#1d4ed8" strokeWidth="3" />
        <path d="M52 108c4-40 20-52 34-30s20 12 22-14" fill="none" stroke="#2563eb" strokeWidth="5" strokeLinecap="round" />
        <path d="M52 108L52 80M108 64L120 52" stroke="#93c5fd" strokeWidth="2" />
        {[[52, 108], [86, 78], [108, 64]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="5" fill="#fff" stroke="#1d4ed8" strokeWidth="3" />)}
        <circle cx="52" cy="80" r="3.5" fill="#1d4ed8" /><circle cx="120" cy="52" r="3.5" fill="#1d4ed8" />
        <circle cx="116" cy="112" r="14" fill="#f97316" opacity="0.9" />
      </>
    ),
  },
};

export default function ProductArt({ id, emoji, className }: { id: string; emoji?: string; className?: string }) {
  const a = art[id];
  return (
    <div className={cn('grid place-items-center overflow-hidden bg-gradient-to-br', a?.bg ?? 'from-brand-soft to-chip', className)} aria-hidden>
      {a ? <svg viewBox="0 0 160 160" className="h-full max-h-[190px] w-full max-w-[190px]">{a.svg}</svg> : <span className="text-6xl">{emoji}</span>}
    </div>
  );
}
