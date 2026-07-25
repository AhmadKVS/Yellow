'use client';

import React from 'react';
import { initialsFor } from '@/lib/initials';
import type { Profile } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks — set explicitly so the bubbles never fall back to a
   system face, regardless of what global CSS is in play.              */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const FALLBACK_GRADIENT: [string, string] = ['#FFD860', '#B8860B'];

/** Under this diameter a name can't be set legibly inside the disc, so the
 *  monogram carries the bubble alone — watchOS does the same with small icons. */
const NAME_MIN_SIZE = 64;

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
/* gold barely move. On glass the hue shows as a tint, not a fill.      */
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

/** The persona's hue, rotated toward gold. */
function harmonizeHue(hex: string, warmth: number): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return GOLD_HUE;
  const [h] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  let d = (((h - GOLD_HUE + 540) % 360) - 180) * (1 - clamp01(warmth));
  // A much tighter arc than the old solid discs used. The material is bright
  // now, which magnifies hue: at ±14° the field ran from rust to chartreuse.
  // ±7° still tells people apart (warm gold → pale gold) without letting any
  // disc leave the yellow family.
  d = clamp(d, -7, 7);
  return (GOLD_HUE + d + 360) % 360;
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
  /** 0..1 — how much this person overlaps with you. Drives glass intensity. */
  prominence?: number;
  /** `me` is you — the strongest tint in the field. */
  variant?: 'me' | 'match';
  /** watchOS focus treatment — hairline yellow ring + a slight scale-up. */
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
  overflow:hidden;
  background-color:rgba(255,255,255,.05);
  /* The brightness lift is the whole trick. A translucent yellow over a
     true-black canvas is arithmetically a dark yellow — i.e. olive — however
     the tint is mixed, and the only escape is to give the glass something lit
     to refract. Raising the backdrop ~2.8x makes the grid read brighter
     through a disc than beside it, which is how a real lens behaves, and it
     lifts the floor enough that the tint lands on yellow instead of mud.
     Black stays black under it, so the empty canvas is untouched. */
  backdrop-filter: blur(18px) saturate(1.6) brightness(2.8);
  -webkit-backdrop-filter: blur(18px) saturate(1.6) brightness(2.8);
  box-shadow: var(--y-glow);
  transform: translateZ(0) scale(1);
  transition: transform 420ms cubic-bezier(.32,.72,0,1),
              box-shadow 420ms cubic-bezier(.32,.72,0,1);
}
/* a portrait is content, not material — nothing shows through it, so the
   blur would be pure cost */
.y-bub-photo{ backdrop-filter:none; -webkit-backdrop-filter:none; background-color:#0E0C07; }
/* no backdrop-filter support, or the field measured itself below 45fps:
   raise the fill so nobody ever sees see-through soup */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){
  .y-bub{ background-color:rgba(60,48,10,.85); }
}
.y-noglass .y-bub{
  backdrop-filter:none; -webkit-backdrop-filter:none;
  background-color:rgba(60,48,10,.85);
}
.y-bub-i{ cursor:pointer; -webkit-tap-highlight-color:transparent; }
.y-bub-i:hover{ transform: translateZ(0) scale(1.045); box-shadow: var(--y-glow-hi); }
.y-bub-i:active{ transform: translateZ(0) scale(.955); transition-duration:120ms; }
.y-bub-i:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }
/* declared last so it wins the tie against :hover, and raises specificity
   over :hover / :active while the card for this person is open */
.y-bub.y-bub-sel,
.y-bub-i.y-bub-sel:hover,
.y-bub-i.y-bub-sel:active{ transform: translateZ(0) scale(1.06); }
/* the name lives inside the disc, where the collision solver guarantees
   nothing can ever cover it */
.y-bub-name{
  pointer-events:none; max-width:82%;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  text-align:center;
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

  const label = firstName(profile?.name);
  const photoUrl = profile?.photoUrl?.trim() || undefined;
  const showName = Boolean(showLabel && label && size >= NAME_MIN_SIZE);

  /* --- Yellow glass. The disc is a tint over a frosted, brightened backdrop,
         so the grid and the threads behind it bend and glow as it drifts
         past. Overlap changes density only: more shared, more solid glass.

         The tint sits far higher than a normal glass recipe (≈0.66–0.80 vs
         0.2) and that is deliberate. Alpha against black is a straight
         multiply, so the "correct" low-alpha yellow renders as muddy olive
         — the exact thing this screen was rejected for. Held up by the
         backdrop's brightness lift, this reads as lit yellow glass while the
         grid still passes visibly through every disc. */
  const hue =
    harmonizeHue(grad[0], warmth) * 0.5 + harmonizeHue(grad[1], warmth) * 0.5;
  const tint = clamp(0.66 + p * 0.1 + (isMe ? 0.04 : 0), 0.66, 0.8);
  const tintOf = (a: number, l = 54) =>
    `hsl(${hue.toFixed(1)} 100% ${l}% / ${clamp(a, 0, 1).toFixed(3)})`;

  const backgroundImage = [
    `linear-gradient(180deg, rgba(255,255,255,.2) 0%, rgba(255,255,255,.05) 44%, rgba(255,255,255,0) 78%)`,
    `linear-gradient(180deg, ${tintOf(tint + 0.07, 62)} 0%, ${tintOf(
      tint
    )} 56%, ${tintOf(tint - 0.08, 47)} 100%)`,
  ].join(',');

  /* --- Light budget: the discs earn their depth from black and from what
         they refract, not from bloom. Only the focus ring is yellow light,
         and only on the one bubble whose card is open. */
  const contact = `0 ${Math.round(size * 0.08)}px ${Math.round(
    size * 0.2
  )}px -${Math.round(size * 0.08)}px rgba(0,0,0,.6)`;

  const core = photoUrl
    ? [`inset 0 0 0 1px rgba(255,255,255,.14)`, contact]
    : [
        `inset 0 1px 0 rgba(255,255,255,.3)`,
        `inset 0 0 0 1px rgba(255,255,255,${(0.14 + p * 0.1).toFixed(3)})`,
        contact,
      ];

  /* watchOS focus: a hairline ring sitting just off the edge, plus the
     faintest halo so it separates from a bubble packed in behind it. */
  const ring = selected
    ? [
        `0 0 0 1.5px rgba(255,214,10,.95)`,
        `0 0 0 5px rgba(255,214,10,.10)`,
        `0 0 20px rgba(255,214,10,.2)`,
      ]
    : [];

  const glow = [...ring, ...core].join(',');

  const glowHi = [
    ...(selected ? ring : [`0 0 0 1px rgba(255,214,10,.34)`]),
    ...core,
  ].join(',');

  /* Apple Contacts monogram — one letter reads bigger than two. Shrinks a
     little when a name label shares the disc with it. */
  const mono = initialsFor(profile?.name);
  const monoSize = Math.round(
    size * (mono.length > 1 ? 0.32 : 0.4) * (showName ? 0.82 : 1)
  );
  const nameSize = Math.round(clamp(size * 0.115, 10.5, 15) * 2) / 2;

  const a11y =
    ariaLabel ??
    (isMe
      ? `You — ${profile?.name ?? ''}`
      : `${profile?.name ?? 'Person'}. Open profile.`);

  const discStyle: React.CSSProperties = {
    backgroundImage: photoUrl ? undefined : backgroundImage,
    ['--y-glow' as string]: glow,
    ['--y-glow-hi' as string]: glowHi,
  };

  const nameEl = showName ? (
    <span
      aria-hidden
      className="y-bub-name"
      style={{
        fontFamily: SANS,
        fontSize: nameSize,
        fontWeight: 600,
        letterSpacing: '-0.012em',
        lineHeight: 1.15,
        color: '#FFF8E7',
        textShadow: '0 1px 2px rgba(0,0,0,.35)',
      }}
    >
      {label}
    </span>
  ) : null;

  const inner = photoUrl ? (
    /* iOS contact-poster grammar: the portrait is full-bleed, and the name
       sits in the lower third over a scrim clipped to the circle — so the
       face is never written across. */
    <>
      <img
        src={photoUrl}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: 'inherit',
          transform: 'translateZ(0)',
        }}
      />
      {showName ? (
        <>
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              pointerEvents: 'none',
              background:
                'linear-gradient(180deg, transparent 55%, rgba(0,0,0,.55) 100%)',
            }}
          />
          <span
            aria-hidden
            className="y-bub-name"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: Math.round(size * 0.1),
              margin: '0 auto',
              fontFamily: SANS,
              fontSize: nameSize,
              fontWeight: 600,
              letterSpacing: '-0.012em',
              lineHeight: 1.15,
              color: '#FFF8E7',
              textShadow: '0 1px 3px rgba(0,0,0,.6)',
            }}
          >
            {label}
          </span>
        </>
      ) : null}
    </>
  ) : (
    <>
      <span
        aria-hidden
        style={{
          fontFamily: SANS,
          fontSize: monoSize,
          fontWeight: 600,
          letterSpacing: '0.02em',
          lineHeight: 1,
          color: '#FFF8E7',
          marginBottom: showName ? Math.round(size * 0.03) : 0,
          textShadow: '0 1px 3px rgba(0,0,0,.28)',
        }}
      >
        {mono}
      </span>
      {nameEl}
    </>
  );

  const cls = [
    'y-bub',
    interactive ? 'y-bub-i' : '',
    photoUrl ? 'y-bub-photo' : '',
    selected ? 'y-bub-sel' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
          className={cls}
          style={discStyle}
        >
          {inner}
        </button>
      ) : (
        <div aria-hidden className={cls} style={discStyle}>
          {inner}
        </div>
      )}
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
