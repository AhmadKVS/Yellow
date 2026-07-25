'use client';

import React from 'react';
import type { Profile } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks — set explicitly so the bubbles never fall back to a
   system face, regardless of what global CSS is in play.              */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';
const EMOJI =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const FALLBACK_GRADIENT: [string, string] = ['#FFD860', '#B8860B'];

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
const clamp01 = (n: number) =>
  Number.isFinite(n) ? clamp(n, 0, 1) : 0;

/* ------------------------------------------------------------------ */
/* Warm harmony                                                        */
/*                                                                     */
/* Personas arrive with free-range brand colours — blues, purples,      */
/* teals. Ten of those in one cluster reads "generic bubble app", not   */
/* Yellow. So every hue is rotated toward gold along the shorter arc,   */
/* which keeps people distinguishable (copper / amber / honey / olive)  */
/* while making the whole field unmistakably warm. Hues already near    */
/* gold barely move.                                                    */
/* ------------------------------------------------------------------ */
const GOLD_HUE = 45;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [GOLD_HUE, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function harmonize(hex: string, warmth: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  // signed shortest distance from gold, in [-180, 180]
  let d = (((h - GOLD_HUE + 540) % 360) - 180) * (1 - clamp01(warmth));
  d = clamp(d, -42, 28);
  const nh = (GOLD_HUE + d + 360) % 360;
  // floors keep every disc rich enough to hold its own glow; the ceiling
  // stops pale source colours from washing out to milk
  const ns = clamp(s, 0.55, 0.98);
  const nl = clamp(l, 0.32, 0.68);
  return `hsl(${nh.toFixed(1)} ${(ns * 100).toFixed(1)}% ${(nl * 100).toFixed(
    1
  )}%)`;
}

function firstName(name: string | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[0] || name;
}

export interface BubbleProps {
  /** The person this bubble represents. `SeedPersona` satisfies this too. */
  profile: Profile;
  /** Diameter of the disc, in px. Everything else scales off this. */
  size: number;
  /** 0..1 — how much this person overlaps with you. Drives glow intensity. */
  prominence?: number;
  /** `me` renders the name inside the disc; `match` renders it underneath. */
  variant?: 'me' | 'match';
  /** Adds a bright focus ring — used while its profile card is open. */
  selected?: boolean;
  /** false renders a plain div (for avatars inside cards/banners). */
  interactive?: boolean;
  /** Hide the name entirely (avatar use). */
  showLabel?: boolean;
  /** Override the generated accessible label. */
  ariaLabel?: string;
  /**
   * How hard to pull the persona's colours toward gold. 0 = use their raw
   * hex untouched, 1 = every bubble is the same gold. Default 0.78 keeps
   * people distinguishable inside a warm family.
   */
  warmth?: number;
  onClick?: (profile: Profile) => void;
  className?: string;
  style?: React.CSSProperties;
}

/* Scoped stylesheet. React dedupes by `href`, so rendering this inside
   every bubble is free. Hover/focus live here rather than inline so the
   inline `--y-glow*` custom properties never win a specificity fight. */
function BubbleStyles() {
  return (
    <style href="yellow-bubble" precedence="high">{`
.y-bub{
  position:absolute; inset:0; border-radius:9999px; padding:0; border:0;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  isolation:isolate; overflow:hidden;
  box-shadow: var(--y-glow);
  transform: translateZ(0) scale(1);
  transition: transform 460ms cubic-bezier(.22,1,.36,1),
              box-shadow 460ms cubic-bezier(.22,1,.36,1),
              filter 460ms cubic-bezier(.22,1,.36,1);
}
.y-bub-i{ cursor:pointer; -webkit-tap-highlight-color:transparent; }
.y-bub-i:hover{ transform: translateZ(0) scale(1.065); box-shadow: var(--y-glow-hi); }
.y-bub-i:active{ transform: translateZ(0) scale(.935); transition-duration:130ms; }
.y-bub-i:focus-visible{
  outline:2px solid #FFD60A; outline-offset:4px; box-shadow: var(--y-glow-hi);
}
.y-bub-spec{
  position:absolute; border-radius:9999px; pointer-events:none;
  background: radial-gradient(circle, rgba(255,255,255,.85) 0%, rgba(255,255,255,.28) 42%, rgba(255,255,255,0) 72%);
}
.y-bub-label{
  position:absolute; left:50%; top:100%; transform:translateX(-50%);
  white-space:nowrap; pointer-events:none; z-index:2;
  transition: color 320ms cubic-bezier(.22,1,.36,1);
}
@media (prefers-reduced-motion: reduce){
  .y-bub{ transition-duration:1ms; }
  .y-bub-i:hover{ transform: translateZ(0) scale(1.02); }
}
`}</style>
  );
}

function BubbleImpl({
  profile,
  size,
  prominence = 0.5,
  variant = 'match',
  selected = false,
  interactive = true,
  showLabel = true,
  ariaLabel,
  warmth = 0.78,
  onClick,
  className,
  style,
}: BubbleProps) {
  const p = clamp01(prominence);
  const isMe = variant === 'me';
  const grad =
    profile?.gradient && profile.gradient.length === 2
      ? profile.gradient
      : FALLBACK_GRADIENT;
  const g0 = harmonize(grad[0], warmth);
  const g1 = harmonize(grad[1], warmth);

  /* --- The sphere. Four stacked layers, painted back to front:
         persona colour → underside shading → warm unifying wash →
         top-left specular. Order in `background-image` is front-to-back. */
  const backgroundImage = [
    `radial-gradient(circle at 30% 21%, rgba(255,255,255,.5) 0%, rgba(255,255,255,.14) 20%, rgba(255,255,255,0) 46%)`,
    `radial-gradient(circle at 50% 42%, rgba(255,214,10,.10) 0%, rgba(255,140,0,.06) 58%, rgba(0,0,0,0) 100%)`,
    `radial-gradient(circle at 50% 118%, rgba(0,0,0,.46) 0%, rgba(0,0,0,.12) 44%, rgba(0,0,0,0) 66%)`,
    `radial-gradient(circle at 34% 24%, ${g0} 0%, ${g1} 74%, ${g1} 100%)`,
  ].join(',');

  /* --- Light, layered so it reads as bloom rather than a drop shadow.
         Near halo is tight and saturated; far halo is wide and dilute. */
  const meBoost = isMe ? 1 : 0;
  const nearR = Math.round(15 + p * 28 + meBoost * 20);
  const farR = Math.round(38 + p * 62 + meBoost * 46);
  const nearA = (0.14 + p * 0.26 + meBoost * 0.16).toFixed(3);
  const farA = (0.05 + p * 0.13 + meBoost * 0.11).toFixed(3);
  const rimA = (0.1 + p * 0.22 + meBoost * 0.18).toFixed(3);

  const core = [
    `inset 0 1px 1px rgba(255,255,255,.34)`,
    `inset 0 -${Math.round(size * 0.14)}px ${Math.round(
      size * 0.26
    )}px -${Math.round(size * 0.12)}px rgba(0,0,0,.5)`,
    `inset 0 0 0 1px rgba(255,214,10,${rimA})`,
    `0 ${Math.round(size * 0.09)}px ${Math.round(
      size * 0.24
    )}px -${Math.round(size * 0.08)}px rgba(0,0,0,.62)`,
  ];

  const ring = selected
    ? [
        `0 0 0 2px rgba(255,214,10,.92)`,
        `0 0 0 8px rgba(255,214,10,.12)`,
      ]
    : [];

  const glow = [
    ...ring,
    ...core,
    `0 0 ${nearR}px rgba(255,214,10,${nearA})`,
    `0 0 ${farR}px rgba(255,178,0,${farA})`,
  ].join(',');

  const glowHi = [
    ...ring,
    ...core,
    `0 0 ${Math.round(nearR * 1.5)}px rgba(255,214,10,${Math.min(
      0.62,
      Number(nearA) * 1.55
    ).toFixed(3)})`,
    `0 0 ${Math.round(farR * 1.45)}px rgba(255,190,0,${Math.min(
      0.42,
      Number(farA) * 1.7
    ).toFixed(3)})`,
  ].join(',');

  /* --- Type scale. Small bubbles get a bigger emoji (no inner name to
         share the space with) and a floor on the label size so a 56px
         bubble never ends up with 7px type. */
  const nameInside = isMe;
  const emojiSize = Math.round(nameInside ? size * 0.3 : size * 0.42);
  const innerNameSize = Math.round(Math.min(16, Math.max(11, size * 0.115)));
  const outerNameSize = Math.min(13, Math.max(9.5, size * 0.135));

  const label = firstName(profile?.name);
  const a11y =
    ariaLabel ??
    (isMe
      ? `You — ${profile?.name ?? ''}`
      : `${profile?.name ?? 'Person'}. Open profile.`);

  const discStyle: React.CSSProperties = {
    backgroundImage,
    ['--y-glow' as string]: glow,
    ['--y-glow-hi' as string]: glowHi,
  };

  const inner = (
    <>
      {/* crisp secondary specular — sells the glass sphere */}
      <span
        className="y-bub-spec"
        aria-hidden
        style={{
          left: `${size * 0.16}px`,
          top: `${size * 0.12}px`,
          width: `${size * 0.3}px`,
          height: `${size * 0.22}px`,
          filter: `blur(${Math.max(1.5, size * 0.028)}px)`,
          opacity: 0.75,
        }}
      />
      <span
        aria-hidden
        style={{
          fontFamily: EMOJI,
          fontSize: emojiSize,
          lineHeight: 1,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.32))',
          transform: nameInside ? 'translateY(-2px)' : 'none',
        }}
      >
        {profile?.emoji ?? '🙂'}
      </span>
      {nameInside && showLabel && label ? (
        <span
          aria-hidden
          style={{
            fontFamily: SANS,
            fontSize: innerNameSize,
            fontWeight: 650,
            letterSpacing: '-0.012em',
            lineHeight: 1.1,
            marginTop: Math.round(size * 0.045),
            color: 'rgba(255,248,231,.97)',
            textShadow: '0 1px 4px rgba(0,0,0,.55)',
            maxWidth: size * 0.82,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        ...style,
      }}
    >
      <BubbleStyles />

      {interactive ? (
        <button
          type="button"
          aria-label={a11y}
          aria-pressed={selected || undefined}
          onClick={onClick ? () => onClick(profile) : undefined}
          className="y-bub y-bub-i"
          style={discStyle}
        >
          {inner}
        </button>
      ) : (
        <div aria-hidden className="y-bub" style={discStyle}>
          {inner}
        </div>
      )}

      {!nameInside && showLabel && label ? (
        <span
          aria-hidden
          className="y-bub-label"
          style={{
            fontFamily: SANS,
            fontSize: outerNameSize,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            marginTop: Math.round(size * 0.06) + 2,
            color: selected ? '#FFD60A' : 'rgba(255,248,231,.9)',
            textShadow:
              '0 1px 5px rgba(6,5,3,.95), 0 0 12px rgba(6,5,3,.8), 0 0 22px rgba(6,5,3,.55)',
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/* The field writes positions straight to the DOM every frame — these must
   never re-render on an animation tick. Compare only what can actually
   change the pixels. */
const Bubble = React.memo(BubbleImpl, (a, b) => {
  return (
    a.profile === b.profile &&
    a.profile?.id === b.profile?.id &&
    a.size === b.size &&
    a.prominence === b.prominence &&
    a.variant === b.variant &&
    a.selected === b.selected &&
    a.warmth === b.warmth &&
    a.interactive === b.interactive &&
    a.showLabel === b.showLabel &&
    a.ariaLabel === b.ariaLabel &&
    a.onClick === b.onClick &&
    a.className === b.className &&
    a.style === b.style
  );
});

Bubble.displayName = 'Bubble';

export { MONO as YELLOW_MONO, SANS as YELLOW_SANS };
export default Bubble;
