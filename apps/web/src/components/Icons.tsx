import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 20, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest
});

export function Logo({ size = 36, tone = 'gold' }: { size?: number; tone?: 'gold' | 'dark' }) {
  const tile = tone === 'gold' ? '#E8B54A' : '#0A0C10';
  const ink = tone === 'gold' ? '#0A0C10' : '#E8B54A';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill={tile} />
      <path d="M14 44V26l9 7 9-15 9 15 9-7v18z" fill={ink} />
      <circle cx="14" cy="23" r="3.2" fill={ink} />
      <circle cx="32" cy="14.5" r="3.2" fill={ink} />
      <circle cx="50" cy="23" r="3.2" fill={ink} />
      <rect x="14" y="47" width="36" height="5" rx="2" fill={ink} />
    </svg>
  );
}

export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const IconUser = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M5 12l5 5L20 7" /></svg>
);
export const IconTicket = (p: P) => (
  <svg {...base(p)}><path d="M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z" /></svg>
);
export const IconHome = (p: P) => (
  <svg {...base(p)}><path d="M3 11l9-7 9 7v9H3z" /></svg>
);
export const IconLive = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></svg>
);
export const IconGrid = (p: P) => (
  <svg {...base(p)}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /></svg>
);
export const IconPhone = (p: P) => (
  <svg {...base(p)}><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></svg>
);
