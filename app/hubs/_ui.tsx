'use client';

/**
 * Shared chrome for the two hub screens.
 *
 * Private module: the leading underscore keeps it out of the router, and it
 * lives beside the pages that use it rather than in `components/` because
 * nothing else in the app has a use for it.
 *
 * All CSS ships through React 19's `<style href precedence="high">` (deduped
 * by href), so `app/globals.css` stays untouched.
 *
 * The grammar is iOS: inset-grouped lists on a near-black canvas, hairlines
 * that start after the leading tile, pills for actions, glass for the one
 * floating layer, and mono reserved for instrumentation.
 */

import { useMemo } from 'react';
import Bubble from '@/components/Bubble';
import { hubCoverage } from '@/lib/hubs';
import type { Profile } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks                                                          */
/* ------------------------------------------------------------------ */
export const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';
export const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/**
 * PhoneFrame owns the scroll container and the column's horizontal padding,
 * so pages size themselves against the viewport rather than a flex parent.
 */
export const FILL_VIEWPORT = 'calc(100dvh - 96px)';

/** Project-shaped, not face-shaped — a hub is a thing you build, not a person. */
export const HUB_EMOJI = [
  '🚀',
  '🧪',
  '🌱',
  '🛠️',
  '🧠',
  '📚',
  '🎧',
  '🏗️',
  '🔭',
  '🍜',
  '⚡',
  '🌍',
];

/* ------------------------------------------------------------------ */
/* Chrome icons — inline SVG, stroke 1.8, round caps. Never emoji.      */
/* ------------------------------------------------------------------ */

type IconProps = { size?: number };

const strokeProps = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

export function IconPlus({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M8 3v10M3 8h10" {...strokeProps} />
    </svg>
  );
}

export function IconChevronRight({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M6 3.5L10.5 8L6 12.5" {...strokeProps} />
    </svg>
  );
}

export function IconChevronLeft({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M10 3.5L5.5 8L10 12.5" {...strokeProps} />
    </svg>
  );
}

export function IconChevronDown({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3.5 6L8 10.5L12.5 6" {...strokeProps} />
    </svg>
  );
}

export function IconClose({ size = 11 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" {...strokeProps} />
    </svg>
  );
}

export function IconCheck({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3.4 8.4L6.5 11.5L12.6 4.8" {...strokeProps} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists + dedupes by href                   */
/* ------------------------------------------------------------------ */
export function HubStyles() {
  return (
    <style href="yellow-hubs" precedence="high">{`
/* ============================ inset groups ============================ */
/* iOS grouped lists: one card per section, hairlines between rows that
   start after the leading tile so the artwork column stays clean. */
.y-hb-group{
  position:relative; border-radius:18px; overflow:hidden;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 10px 30px -12px rgba(0,0,0,.6);
}
ul.y-hb-group{ list-style:none; margin:0; padding:0 }

.y-hb-row{
  position:relative; display:flex; align-items:center; gap:12px; width:100%;
  min-height:52px; padding:13px 14px; margin:0;
  text-align:left; text-decoration:none; color:inherit;
  background:transparent; border:0;
  transition:background 220ms cubic-bezier(.32,.72,0,1);
}
.y-hb-row + .y-hb-row::before{
  content:''; position:absolute; left:var(--sep,14px); right:0; top:0; height:1px;
  background:rgba(255,255,255,.08);
}
a.y-hb-row:hover, button.y-hb-row:hover{ background:rgba(255,255,255,.03) }
/* Inset outline: the group clips its corners, so an outward ring would be
   sliced off by the very card that makes the row a row. */
.y-hb-row:focus-visible{ outline:2px solid #FFD60A; outline-offset:-2px }

/* ================================ tiles =============================== */
.y-hb-tile{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:44px; height:44px; border-radius:12px;
  background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06);
}
.y-hb-tile-lg{ width:52px; height:52px; border-radius:14px }

.y-hb-chev{ flex-shrink:0; color:rgba(255,248,231,.25); display:inline-flex }

/* ================================ type ================================ */
.y-hb-title{
  font-size:30px; font-weight:700; letter-spacing:-.03em; line-height:1.08;
  color:#FFF8E7; margin:0;
}
.y-hb-h2{
  font-size:21px; font-weight:600; letter-spacing:-.02em; line-height:1.2;
  color:#FFF8E7; margin:0;
}
.y-hb-headline{
  font-size:16.5px; font-weight:600; letter-spacing:-.016em; line-height:1.28;
  color:#FFF8E7; margin:0;
}
.y-hb-body{
  font-size:15px; font-weight:400; line-height:1.5; letter-spacing:-.006em;
  color:rgba(255,248,231,.62); margin:0;
}
.y-hb-sub{
  font-size:13.5px; font-weight:400; line-height:1.4; letter-spacing:-.004em;
  color:rgba(255,248,231,.62); margin:0;
}
.y-hb-foot{
  font-size:12.5px; line-height:1.45; color:rgba(255,248,231,.4); margin:0;
}
.y-hb-clip{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap }

/* Instrumentation only: counters, timestamps, badges. */
.y-hb-mono{
  font-size:11px; letter-spacing:.04em; line-height:1.4;
  color:rgba(255,248,231,.4); font-variant-numeric:tabular-nums;
}
.y-hb-dot{ opacity:.36; padding:0 5px }
.y-hb-warn{ color:#FFC300 }
.y-hb-soon{ color:rgba(255,214,10,.8) }

/* =============================== buttons ============================== */
/* Filled — one per screen. */
.y-hb-cta{
  display:flex; align-items:center; justify-content:center; gap:8px;
  width:100%; height:50px; border-radius:999px; border:0; cursor:pointer;
  font-size:15px; font-weight:600; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55), inset 0 1px 0 rgba(255,255,255,.45);
  transition:transform 120ms cubic-bezier(.32,.72,0,1), filter 180ms linear,
             opacity 180ms linear, box-shadow 180ms linear;
  -webkit-tap-highlight-color:transparent;
}
.y-hb-cta:hover:not(:disabled){ filter:brightness(1.04) }
.y-hb-cta:active:not(:disabled){ transform:scale(.97) }
.y-hb-cta:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-cta:disabled{
  cursor:default; background:rgba(255,255,255,.06); color:rgba(255,248,231,.26);
  box-shadow:none;
}

/* Tinted — the secondary workhorse. Yellow glass: a tint over a white
   film, lit along the top edge, refracting whatever it floats over. */
.y-hb-pill{
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  gap:6px; height:44px; padding:0 18px; border-radius:999px; cursor:pointer;
  white-space:nowrap; font-size:14px; font-weight:600; letter-spacing:-.01em;
  color:#FFD60A;
  background:linear-gradient(0deg,rgba(255,214,10,.13),rgba(255,214,10,.13)),
             rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  backdrop-filter:blur(18px) saturate(1.6);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22);
  transition:background 200ms linear, border-color 200ms linear,
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.y-hb-pill:hover:not(:disabled){
  background:linear-gradient(0deg,rgba(255,214,10,.19),rgba(255,214,10,.19)),
             rgba(255,255,255,.07);
  border-color:rgba(255,255,255,.22);
}
.y-hb-pill:active:not(:disabled){ transform:scale(.97) }
.y-hb-pill:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-pill:disabled{ cursor:default; opacity:.4 }

/* Compact pill — visually 34px, but its hit area is still 44. */
.y-hb-pill-sm{ height:34px; padding:0 13px; font-size:13px; gap:5px }
.y-hb-pill-sm::after{ content:''; position:absolute; inset:-5px; border-radius:inherit }

/* Plain — tertiary, and the only way destructive is allowed to look. */
.y-hb-plain{
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  gap:6px; height:44px; padding:0 14px; border-radius:999px; cursor:pointer;
  white-space:nowrap; font-size:14px; font-weight:500; letter-spacing:-.008em;
  color:rgba(255,248,231,.62); background:transparent; border:1px solid transparent;
  transition:color 200ms linear, background 200ms linear;
  -webkit-tap-highlight-color:transparent; text-decoration:none;
}
.y-hb-plain:hover:not(:disabled){ color:#FFD60A; background:rgba(255,255,255,.04) }
.y-hb-plain:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-plain:disabled{ cursor:default; opacity:.4 }
/* Compact plain — visually 34px to sit level with the small pill, but the
   finger still gets 44. */
.y-hb-plain-sm{ height:34px; padding:0 11px; font-size:13px }
.y-hb-plain-sm::after{ content:''; position:absolute; inset:-5px; border-radius:inherit }
.y-hb-plain-hair{ border-color:rgba(255,255,255,.14); color:rgba(255,248,231,.72) }
.y-hb-plain-hair:hover:not(:disabled){ color:#FFF8E7; background:rgba(255,255,255,.05) }

/* Quiet × — delete, remove, dismiss. Never red. */
.y-hb-x{
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  flex-shrink:0; width:28px; height:28px; border-radius:999px; cursor:pointer;
  color:rgba(255,248,231,.35); background:transparent; border:0;
  transition:color 200ms linear, background 200ms linear;
  -webkit-tap-highlight-color:transparent;
}
.y-hb-x::after{ content:''; position:absolute; inset:-8px; border-radius:inherit }
.y-hb-x:hover:not(:disabled){ color:rgba(255,248,231,.85); background:rgba(255,255,255,.06) }
.y-hb-x:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-x:disabled{ cursor:default; opacity:.35 }

/* Person picker chip-button. */
.y-hb-add{
  position:relative; display:inline-flex; align-items:center; gap:8px;
  height:40px; padding:0 13px 0 5px; border-radius:999px; cursor:pointer;
  white-space:nowrap; font-size:13.5px; font-weight:500; letter-spacing:-.008em;
  color:rgba(255,248,231,.86); background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.08);
  transition:background 200ms linear, border-color 200ms linear,
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.y-hb-add::after{ content:''; position:absolute; inset:-2px; border-radius:inherit }
.y-hb-add:hover:not(:disabled){ background:rgba(255,214,10,.11); border-color:rgba(255,214,10,.26) }
.y-hb-add:active:not(:disabled){ transform:scale(.97) }
.y-hb-add:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-add:disabled{ cursor:default; opacity:.4 }
.y-hb-add i{ display:inline-flex; color:#FFD60A }

/* ================================ chips =============================== */
/* Chips wear the yellow-glass *fills* but no backdrop-filter: they sit on
   opaque inset cards, where a blur would have nothing to refract and would
   be decoration rather than material. */
.y-hb-chip{
  display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 8px;
  border-radius:10px; white-space:nowrap;
  font-size:11.5px; font-weight:550; letter-spacing:-.002em;
  color:rgba(255,248,231,.58); background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.08);
}
/* Tinted: a tag more than one member holds, a question, an invitation. */
.y-hb-chip-tint{
  color:#FFD60A;
  background:linear-gradient(0deg,rgba(255,214,10,.14),rgba(255,214,10,.14)),
             rgba(255,255,255,.05);
  border-color:rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18);
}
/* Overdue reads warm, not alarmed — same family, more weight. */
.y-hb-chip-late{
  color:#FFC300;
  background:linear-gradient(0deg,rgba(255,195,0,.17),rgba(255,195,0,.17)),
             rgba(255,255,255,.05);
  border-color:rgba(255,255,255,.16);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
  font-variant-numeric:tabular-nums;
}
.y-hb-chip-n{ font-size:9.5px; opacity:.7 }

/* The add-people picker: a floating tinted panel, so it takes real glass. */
.y-hb-panel{
  border-radius:18px; padding:14px 15px;
  background:linear-gradient(0deg,rgba(255,214,10,.12),rgba(255,214,10,.12)),
             rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  backdrop-filter:blur(18px) saturate(1.6);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),
             0 14px 34px -18px rgba(0,0,0,.8);
}

/* ================================ fields ============================== */
.y-hb-field{
  border-radius:14px; background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
  transition:border-color 220ms linear, background 220ms linear;
}
.y-hb-field:focus-within{ border-color:rgba(255,214,10,.5); background:rgba(255,214,10,.045) }
.y-hb-field-split{ border-top:1px solid rgba(255,255,255,.08) }

.y-hb-input, .y-hb-area{
  display:block; width:100%; background:transparent; border:0; outline:none;
  color:#FFF8E7; font-size:15px; letter-spacing:-.008em; line-height:1.5;
}
.y-hb-input{ height:46px; padding:0 14px }
.y-hb-area{ padding:13px 14px; resize:none; min-height:86px }
.y-hb-input::placeholder, .y-hb-area::placeholder{ color:rgba(255,248,231,.26) }
.y-hb-input:disabled, .y-hb-area:disabled{ opacity:.5 }

/* Standalone bordered input (the sheet's form). */
.y-hb-boxed{
  height:46px; padding:0 14px; width:100%; border-radius:14px;
  background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.08);
  color:#FFF8E7; font-size:15px; letter-spacing:-.008em; outline:none;
  transition:border-color 220ms linear, background 220ms linear;
}
.y-hb-boxed::placeholder{ color:rgba(255,248,231,.26) }
.y-hb-boxed:focus{ border-color:rgba(255,214,10,.5); background:rgba(255,214,10,.045) }

/* Quiet inline menu: a native select wearing mono instrumentation. */
.y-hb-menu-wrap{ position:relative; display:inline-flex; align-items:center; flex-shrink:0 }
.y-hb-menu{
  appearance:none; -webkit-appearance:none;
  height:30px; padding:0 20px 0 8px; border:0; border-radius:8px; cursor:pointer;
  background:transparent; color:rgba(255,248,231,.5);
  font-size:11px; letter-spacing:.04em; outline:none; max-width:150px;
  transition:color 180ms linear, background 180ms linear;
}
.y-hb-menu:hover:not(:disabled){ color:#FFD60A; background:rgba(255,214,10,.08) }
.y-hb-menu:focus-visible{ outline:2px solid #FFD60A; outline-offset:1px }
.y-hb-menu:disabled{ cursor:default; opacity:.5 }
.y-hb-menu option{ background:#141109; color:#FFF8E7 }
.y-hb-menu-wrap i{
  position:absolute; right:6px; display:inline-flex; pointer-events:none;
  color:rgba(255,248,231,.3);
}

/* Native date control needs its scheme stated or it renders system-light. */
.y-hb-date{
  height:34px; padding:0 10px; border-radius:10px; cursor:pointer;
  border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.045);
  color:rgba(255,248,231,.72); font-size:12px; outline:none; color-scheme:dark;
  font-variant-numeric:tabular-nums;
}
.y-hb-date:focus-visible{ outline:2px solid #FFD60A; outline-offset:1px }
.y-hb-date:disabled{ opacity:.5 }
.y-hb-date::-webkit-calendar-picker-indicator{ opacity:.4; cursor:pointer }
.y-hb-date:hover::-webkit-calendar-picker-indicator{ opacity:.8 }

/* Emoji picker: selection is a yellow hairline ring, never a yellow slab —
   an emoji on a saturated fill is unreadable. */
.y-hb-emoji{
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  width:100%; aspect-ratio:1; border-radius:12px; cursor:pointer;
  font-size:21px; line-height:1;
  background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.08);
  transition:background 180ms linear, border-color 180ms linear,
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.y-hb-emoji:hover{ background:rgba(255,255,255,.07) }
.y-hb-emoji:active{ transform:scale(.94) }
.y-hb-emoji:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-emoji-on{
  background:linear-gradient(0deg,rgba(255,214,10,.16),rgba(255,214,10,.16)),
             rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  backdrop-filter:blur(18px) saturate(1.6);
  border-color:#FFD60A;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),
             inset 0 0 0 1px rgba(255,214,10,.45);
}

/* ========================= segmented control ========================== */
/* Clear-glass track, yellow-glass thumb — how an iOS segmented control
   actually reads on dark. The thumb travels; it doesn't blink. */
.y-hb-seg{
  position:relative; display:inline-flex; padding:3px; border-radius:999px;
  background:rgba(255,255,255,.06);
  -webkit-backdrop-filter:blur(16px) saturate(1.3);
  backdrop-filter:blur(16px) saturate(1.3);
  border:1px solid rgba(255,255,255,.1);
}
.y-hb-seg-thumb{
  position:absolute; top:3px; bottom:3px; left:3px; width:calc(50% - 3px);
  border-radius:999px; pointer-events:none;
  background:linear-gradient(0deg,rgba(255,214,10,.16),rgba(255,214,10,.16)),
             rgba(255,255,255,.06);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  backdrop-filter:blur(18px) saturate(1.6);
  border:1px solid rgba(255,255,255,.14);
  /* A yellow rim inside the white hairline, so 16% tint over black still
     reads as *yellow* glass rather than olive. */
  box-shadow:inset 0 0 0 1px rgba(255,214,10,.3),
             inset 0 1px 0 rgba(255,255,255,.22),
             0 2px 8px -3px rgba(0,0,0,.55);
  transform:translateX(0);
  transition:transform 340ms cubic-bezier(.32,.72,0,1);
}
.y-hb-seg[data-at="1"] .y-hb-seg-thumb{ transform:translateX(100%) }
/* Equal flex basis, not intrinsic width: the thumb is exactly half the
   track, so both segments have to be exactly half too or it lands short. */
.y-hb-seg button{
  position:relative; z-index:1; flex:1 1 0; height:32px; min-width:90px; padding:0 14px;
  border:0; border-radius:999px; background:transparent; cursor:pointer;
  font-size:13px; font-weight:600; letter-spacing:-.008em;
  color:rgba(255,248,231,.5); transition:color 260ms linear;
  -webkit-tap-highlight-color:transparent;
}
.y-hb-seg button::after{ content:''; position:absolute; inset:-6px; border-radius:inherit }
.y-hb-seg button:hover{ color:rgba(255,248,231,.8) }
.y-hb-seg button[aria-pressed='true']{ color:#FFF8E7 }
.y-hb-seg button:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }

/* ================================= feed =============================== */
.y-hb-post{
  position:relative; border-radius:18px; padding:14px 15px;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
}
/* A question wears a quiet warm accent — the room is being asked something. */
.y-hb-post-q{
  background:rgba(255,214,10,.05); border-color:rgba(255,214,10,.16);
}
.y-hb-post-q::before{
  content:''; position:absolute; left:0; top:15px; bottom:15px; width:2.5px;
  border-radius:0 999px 999px 0;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
}

/* ================================ tasks =============================== */
.y-hb-task{ align-items:flex-start; --sep:52px }
.y-hb-task[data-done='true']{ opacity:.5 }

/* The checkbox: a hairline circle that fills yellow and takes an ink check. */
.y-hb-check{
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  flex-shrink:0; width:26px; height:26px; margin-top:1px; border-radius:999px;
  cursor:pointer; padding:0; color:#1A1200; background:transparent;
  border:1.8px solid rgba(255,248,231,.28);
  transition:background 220ms cubic-bezier(.32,.72,0,1), border-color 220ms linear,
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
/* Glyph is 26px; the finger gets 44. */
.y-hb-check::after{ content:''; position:absolute; inset:-9px; border-radius:inherit }
.y-hb-check:hover:not(:disabled){ border-color:rgba(255,214,10,.65) }
.y-hb-check:active:not(:disabled){ transform:scale(.92) }
.y-hb-check:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-check:disabled{ cursor:default }
.y-hb-check-doing{
  border-color:#FFD60A;
  background:radial-gradient(circle at 50% 50%, #FFC300 0 34%, transparent 35%);
}
.y-hb-check-done{
  border-color:#FFC300;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
}
.y-hb-strike{ text-decoration:line-through; color:rgba(255,248,231,.45) }

/* ================================ board =============================== */
/* Columns are reading surfaces, so they stay near-opaque — no backdrop
   filter behind a stack of task titles. The container query is deliberate:
   the hub column is 560px wide today, so the board scroll-snaps like Trello
   on a phone, and goes three-up by itself the moment the shell gets wider. */
.y-hb-board{ container-type:inline-size }
.y-hb-cols{
  display:flex; align-items:flex-start; gap:12px;
  overflow-x:auto; padding-bottom:4px;
  scroll-snap-type:x proximity; overscroll-behavior-x:contain;
}
.y-hb-cols::-webkit-scrollbar{ height:0 }
.y-hb-col{
  flex:0 0 78%; min-width:0; scroll-snap-align:start;
  display:flex; flex-direction:column; gap:8px;
  border-radius:18px; padding:12px 11px;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 10px 30px -12px rgba(0,0,0,.6);
  transition:border-color 200ms linear, background 200ms linear;
}
@container (min-width: 720px){
  .y-hb-cols{ overflow-x:visible }
  .y-hb-col{ flex:1 1 0 }
}
.y-hb-col[data-over='true']{
  border-color:rgba(255,214,10,.45);
  background:linear-gradient(0deg,rgba(255,214,10,.06),rgba(255,214,10,.06)),
             rgba(255,255,255,.045);
}
.y-hb-colhead{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:2px 3px 2px;
}
.y-hb-count{ font-variant-numeric:tabular-nums; letter-spacing:.06em }

.y-hb-kcard{
  position:relative; border-radius:14px; padding:10px 11px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
  transition:transform 160ms cubic-bezier(.32,.72,0,1), border-color 200ms linear,
             box-shadow 200ms linear, opacity 160ms linear;
}
.y-hb-kcard:hover{
  transform:translateY(-1px); border-color:rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 8px 20px -12px rgba(0,0,0,.85);
}
.y-hb-kcard[data-dragging='true']{ opacity:.32; transform:none }
.y-hb-ktitle{
  margin:0; font-size:14px; line-height:1.36; letter-spacing:-.008em;
  color:#FFF8E7; overflow-wrap:anywhere;
}
.y-hb-kcard[data-done='true'] .y-hb-ktitle{
  text-decoration:line-through; color:rgba(255,248,231,.4);
}
.y-hb-kmeta{
  display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px;
}
/* Card faces are photo-or-monogram on the person's own gradient. No glass:
   a card is a reading surface, and a 20px disc has nothing worth refracting. */
.y-hb-face{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  border-radius:999px; overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.28),
             inset 0 0 0 1px rgba(255,255,255,.14);
}
.y-hb-kdrop{
  height:50px; border-radius:14px; flex-shrink:0;
  border:1.5px dashed rgba(255,214,10,.5); background:rgba(255,214,10,.07);
}
.y-hb-kempty{
  margin:2px 3px 0; font-size:12.5px; line-height:1.45;
  color:rgba(255,248,231,.28);
}
.y-hb-kadd{
  position:relative; display:flex; align-items:center; gap:7px;
  width:100%; min-height:40px; padding:0 8px; border-radius:10px; border:0;
  cursor:pointer; background:transparent; color:rgba(255,248,231,.5);
  font-size:13px; font-weight:500; letter-spacing:-.006em; text-align:left;
  transition:background 180ms linear, color 180ms linear;
  -webkit-tap-highlight-color:transparent;
}
.y-hb-kadd::after{ content:''; position:absolute; inset:-2px; border-radius:inherit }
.y-hb-kadd:hover:not(:disabled){ background:rgba(255,255,255,.05); color:#FFD60A }
.y-hb-kadd:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-kadd:disabled{ cursor:default; opacity:.4 }

/* ================================ sheet =============================== */
.y-hb-scrim{
  position:absolute; inset:0; background:rgba(0,0,0,.5);
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
}
/* Chrome glass. */
.y-hb-sheet{
  background:rgba(20,17,10,.70);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
  backdrop-filter:blur(20px) saturate(1.4);
  border-top:1px solid rgba(255,255,255,.14);
  border-top-left-radius:22px; border-top-right-radius:22px;
  box-shadow:0 -24px 60px -24px rgba(0,0,0,.9);
}
.y-hb-sheet::-webkit-scrollbar{ width:0; height:0 }
.y-hb-grabber{
  width:36px; height:5px; border-radius:999px;
  background:rgba(255,248,231,.22); margin:0 auto;
}

/* ====================== no-backdrop-filter fallback ==================== */
/* Raise the fill so nothing degrades into see-through soup. */
@supports not (backdrop-filter: blur(1px)){
  .y-hb-sheet{ background:rgba(20,17,10,.94) }
  .y-hb-scrim{ background:rgba(0,0,0,.78) }
  .y-hb-pill, .y-hb-pill:hover:not(:disabled),
  .y-hb-panel, .y-hb-emoji-on, .y-hb-seg-thumb{
    background:rgba(60,48,10,.85);
  }
  .y-hb-seg{ background:rgba(40,36,28,.9) }
}

/* ================================ motion ============================== */
@keyframes y-hb-rise{
  from{ opacity:0; transform:translateY(10px) }
  to{ opacity:1; transform:none }
}
.y-hb-rise{ animation:y-hb-rise 320ms cubic-bezier(.32,.72,0,1) both }
.y-hb-in{ animation:y-hb-rise 380ms cubic-bezier(.32,.72,0,1) both }

@media (prefers-reduced-motion: reduce){
  .y-hb-rise, .y-hb-in{ animation-duration:1ms; animation-delay:0ms !important }
  .y-hb-cta, .y-hb-pill, .y-hb-plain, .y-hb-add, .y-hb-emoji, .y-hb-row,
  .y-hb-check, .y-hb-x, .y-hb-field, .y-hb-boxed, .y-hb-menu,
  .y-hb-seg button, .y-hb-seg-thumb, .y-hb-col, .y-hb-kcard,
  .y-hb-kadd{ transition-duration:1ms }
  .y-hb-kcard:hover{ transform:none }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Small parts                                                          */
/* ------------------------------------------------------------------ */

/** Mono eyebrow — the section label. Instrumentation, never a sentence. */
export function Eyebrow({
  children,
  tone = 'dim',
}: {
  children: React.ReactNode;
  tone?: 'dim' | 'gold';
}) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: tone === 'gold' ? 'rgba(184,134,11,.95)' : 'rgba(255,248,231,.4)',
      }}
    >
      {children}
    </span>
  );
}

/** Overlapping avatars. The roster is the container, so it leads. */
export function MemberStack({
  members,
  size = 26,
}: {
  members: Profile[];
  size?: number;
}) {
  const shown = members.slice(0, 5);
  const overflow = members.length - shown.length;
  if (shown.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <span
          key={p.id}
          style={{
            display: 'inline-flex',
            borderRadius: 9999,
            marginLeft: i > 0 ? -8 : 0,
            /* Surface-agnostic separation: the ring is the dark between two
               discs, not a guess at whatever card they happen to sit on. */
            boxShadow: '0 0 0 2px rgba(5,4,3,.92)',
          }}
        >
          <Bubble
            profile={p}
            size={size}
            prominence={0.5}
            interactive={false}
            showLabel={false}
          />
        </span>
      ))}

      {overflow > 0 ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            marginLeft: -8,
            borderRadius: 9999,
            boxShadow: '0 0 0 2px rgba(5,4,3,.92)',
            background: 'rgba(255,255,255,.09)',
            fontFamily: MONO,
            fontSize: 9.5,
            color: 'rgba(255,248,231,.62)',
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The answer to "what is the purpose of a hub — it's just adding people".
 *
 * A roster of names says nothing. The same roster read as *combined coverage*
 * says "this is a team assembled around a project": what these particular
 * people bring between them, with anything more than one of them holds called
 * out in gold, because that overlap is why they're in this room together.
 * Soft skills rank 2× exactly as `matchScore` weights them.
 */
export function CoverageRow({
  members,
  limit = 4,
  total,
  summary = true,
}: {
  /** Members whose profile actually resolved — the tags come from these. */
  members: Profile[];
  limit?: number;
  /**
   * How many people are really in the hub. Defaults to `members.length`, but
   * a member the directory can't resolve yet still counts as a person, so the
   * wording follows the roster rather than what happened to render.
   */
  total?: number;
  /** The counter line under the chips. Off in dense list rows. */
  summary?: boolean;
}) {
  const coverage = useMemo(() => hubCoverage(members), [members]);
  const headcount = total ?? members.length;
  if (coverage.tags.length === 0) return null;

  const shown = coverage.tags.slice(0, limit);
  const rest = coverage.tags.length - shown.length;

  return (
    <span style={{ display: 'block' }}>
      <span
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}
      >
        {shown.map((tag) => (
          <span
            key={`${tag.kind}:${tag.label}`}
            className={`y-hb-chip${tag.count > 1 ? ' y-hb-chip-tint' : ''}`}
            style={{ fontFamily: SANS }}
          >
            {tag.label}
            {tag.count > 1 ? (
              <span className="y-hb-chip-n" style={{ fontFamily: MONO }}>
                ×{tag.count}
              </span>
            ) : null}
          </span>
        ))}
        {rest > 0 ? (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: 'rgba(255,248,231,.26)',
            }}
          >
            +{rest}
          </span>
        ) : null}
      </span>

      {summary ? (
        <span
          className="y-hb-mono"
          style={{ display: 'block', marginTop: 8, fontFamily: MONO }}
        >
          {headcount > 1
            ? `${coverage.totalSkills} soft skills · ${coverage.totalInterests} interests between you` +
              (coverage.shared > 0 ? ` · ${coverage.shared} shared` : '')
            : `${coverage.totalSkills} soft skills · ${coverage.totalInterests} interests so far`}
        </span>
      ) : null}
    </span>
  );
}
