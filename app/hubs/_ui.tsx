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
/* Scoped stylesheet — React hoists + dedupes by href                   */
/* ------------------------------------------------------------------ */
export function HubStyles() {
  return (
    <style href="yellow-hubs" precedence="high">{`
.y-hb-card{
  display:block; border-radius:20px; overflow:hidden; text-decoration:none;
  border:1px solid rgba(255,214,10,.1);
  background:linear-gradient(180deg, rgba(255,248,231,.045) 0%, rgba(255,248,231,.014) 100%);
  transition:border-color 260ms linear, background 260ms linear, transform 260ms cubic-bezier(.22,1,.36,1);
}
.y-hb-card:hover{ border-color:rgba(255,214,10,.22); transform:translateY(-1px) }
.y-hb-card:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }

/* A hub someone pulled you into reads warmer than one you started. */
.y-hb-card-guest{
  border-color:rgba(255,214,10,.26);
  background:linear-gradient(180deg, rgba(255,214,10,.055) 0%, rgba(255,248,231,.016) 100%);
}
.y-hb-card-guest:hover{ border-color:rgba(255,214,10,.42) }

.y-hb-head{ display:flex; align-items:flex-start; gap:13px; width:100%; padding:14px }

.y-hb-tile{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:46px; height:46px; border-radius:14px;
  background:linear-gradient(160deg, rgba(255,214,10,.16) 0%, rgba(255,214,10,.035) 100%);
  border:1px solid rgba(255,214,10,.18);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
}

.y-hb-cta{
  display:flex; align-items:center; justify-content:center; gap:8px;
  width:100%; height:54px; border-radius:16px; border:0; cursor:pointer;
  font-size:16px; font-weight:680; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 12px 32px -12px rgba(255,195,0,.62), inset 0 1px 0 rgba(255,255,255,.62);
  transition:transform 280ms cubic-bezier(.22,1,.36,1), box-shadow 280ms cubic-bezier(.22,1,.36,1),
             filter 200ms linear, opacity 200ms linear;
}
.y-hb-cta:hover:not(:disabled){ transform:translateY(-1.5px); filter:brightness(1.05);
  box-shadow:0 18px 40px -12px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.7); }
.y-hb-cta:active:not(:disabled){ transform:translateY(1px) scale(.993); transition-duration:110ms }
.y-hb-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-hb-cta:disabled{
  cursor:default; opacity:.34; background:rgba(255,248,231,.1);
  color:rgba(255,248,231,.5); box-shadow:none;
}

.y-hb-pill{
  display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 13px;
  border-radius:9999px; cursor:pointer; white-space:nowrap;
  font-size:13px; font-weight:620; letter-spacing:-.008em;
  color:#FFD60A; background:rgba(255,214,10,.07);
  border:1px solid rgba(255,214,10,.28);
  transition:background 200ms linear, border-color 200ms linear, color 200ms linear;
}
.y-hb-pill:hover{ background:rgba(255,214,10,.14); border-color:rgba(255,214,10,.5) }
.y-hb-pill:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-pill:disabled{ cursor:default; opacity:.4 }

.y-hb-quiet{
  color:rgba(255,248,231,.6); background:transparent;
  border-color:rgba(255,248,231,.14);
}
.y-hb-quiet:hover{ background:rgba(255,248,231,.05); border-color:rgba(255,248,231,.26) }
.y-hb-danger{
  color:rgba(255,138,102,.9); background:transparent;
  border-color:rgba(255,138,102,.28);
}
.y-hb-danger:hover{ background:rgba(255,120,90,.1); border-color:rgba(255,138,102,.55) }

.y-hb-add{
  display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 12px 0 5px;
  border-radius:9999px; cursor:pointer; white-space:nowrap;
  font-size:13px; font-weight:600; letter-spacing:-.008em;
  color:rgba(255,248,231,.86); background:rgba(255,248,231,.04);
  border:1px solid rgba(255,248,231,.12);
  transition:background 200ms linear, border-color 200ms linear, transform 200ms cubic-bezier(.22,1,.36,1);
}
.y-hb-add:hover{ background:rgba(255,214,10,.09); border-color:rgba(255,214,10,.4) }
.y-hb-add:active{ transform:scale(.96); transition-duration:110ms }
.y-hb-add:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-add:disabled{ cursor:default; opacity:.4 }

.y-hb-x{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:28px; height:28px; border-radius:9999px; cursor:pointer;
  color:rgba(255,248,231,.4); background:transparent;
  border:1px solid rgba(255,248,231,.1);
  transition:color 200ms linear, border-color 200ms linear, background 200ms linear;
}
.y-hb-x:hover{ color:#FFF8E7; border-color:rgba(255,120,90,.5); background:rgba(255,120,90,.1) }
.y-hb-x:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-x:disabled{ cursor:default; opacity:.35 }

.y-hb-input, .y-hb-area{
  width:100%; border-radius:14px;
  border:1px solid rgba(255,214,10,.15); background:rgba(255,248,231,.04);
  color:#FFF8E7; font-size:15px; letter-spacing:-.008em; outline:none;
  transition:border-color 220ms linear, background 220ms linear;
}
.y-hb-input{ height:48px; padding:0 15px }
.y-hb-area{ padding:13px 15px; line-height:1.5; resize:none; min-height:84px }
.y-hb-input::placeholder, .y-hb-area::placeholder{ color:rgba(255,248,231,.28) }
.y-hb-input:focus, .y-hb-area:focus{ border-color:rgba(255,214,10,.5); background:rgba(255,248,231,.07) }
.y-hb-input:disabled, .y-hb-area:disabled{ opacity:.55 }

/* Native controls need their colours stated or they render system-light. */
.y-hb-select{
  height:38px; padding:0 10px; border-radius:11px; cursor:pointer;
  border:1px solid rgba(255,248,231,.12); background:#141109;
  color:rgba(255,248,231,.86); font-size:13px; outline:none;
}
.y-hb-select:focus-visible{ outline:2px solid #FFD60A; outline-offset:1px }
.y-hb-date{
  height:38px; padding:0 10px; border-radius:11px;
  border:1px solid rgba(255,248,231,.12); background:#141109;
  color:rgba(255,248,231,.86); font-size:13px; outline:none;
  color-scheme:dark;
}
.y-hb-date:focus-visible{ outline:2px solid #FFD60A; outline-offset:1px }

.y-hb-emoji{
  display:inline-flex; align-items:center; justify-content:center;
  width:100%; aspect-ratio:1; border-radius:13px; cursor:pointer;
  font-size:21px; line-height:1;
  background:rgba(255,248,231,.035); border:1px solid rgba(255,248,231,.08);
  transition:background 180ms linear, border-color 180ms linear, transform 180ms cubic-bezier(.22,1,.36,1);
}
.y-hb-emoji:hover{ background:rgba(255,214,10,.09); border-color:rgba(255,214,10,.3) }
.y-hb-emoji:active{ transform:scale(.93); transition-duration:100ms }
.y-hb-emoji:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-emoji-on{
  background:linear-gradient(180deg, rgba(255,228,92,.9) 0%, rgba(255,195,0,.85) 100%);
  border-color:rgba(255,214,10,.9);
  box-shadow:0 4px 16px -6px rgba(255,195,0,.7), inset 0 1px 0 rgba(255,255,255,.5);
}

/* Coverage chips — what this group is made of, not who is in it. */
.y-hb-chip{
  display:inline-flex; align-items:center; gap:5px; height:23px; padding:0 8px;
  border-radius:7px; white-space:nowrap;
  font-size:11.5px; font-weight:560; letter-spacing:-.004em;
  color:rgba(255,248,231,.62); background:rgba(255,248,231,.045);
  border:1px solid rgba(255,248,231,.08);
}
/* A tag more than one member holds is the overlap the hub was built on. */
.y-hb-chip-shared{
  color:#FFD60A; background:rgba(255,214,10,.1); border-color:rgba(255,214,10,.26);
}
.y-hb-chip-n{ font-size:9.5px; opacity:.75 }

.y-hb-dot{ opacity:.4; padding:0 5px }
.y-hb-warn{ color:rgba(255,138,102,.9) }
.y-hb-soon{ color:rgba(255,214,10,.82) }

/* Feed */
.y-hb-post{
  border-radius:16px; padding:12px 13px;
  border:1px solid rgba(255,248,231,.07);
  background:rgba(255,248,231,.022);
}
/* An unanswered question is a call to action, so it reads as one. */
.y-hb-post-q{
  border-color:rgba(255,214,10,.3);
  background:linear-gradient(180deg, rgba(255,214,10,.075) 0%, rgba(255,248,231,.02) 100%);
  box-shadow:inset 3px 0 0 -0.5px #FFC300;
}

.y-hb-seg{
  display:inline-flex; padding:3px; border-radius:11px; gap:3px;
  background:rgba(255,248,231,.05); border:1px solid rgba(255,248,231,.08);
}
.y-hb-seg button{
  height:28px; padding:0 12px; border:0; border-radius:8px; cursor:pointer;
  font-size:12.5px; font-weight:600; letter-spacing:-.006em;
  color:rgba(255,248,231,.5); background:transparent;
  transition:background 180ms linear, color 180ms linear;
}
.y-hb-seg button:hover{ color:rgba(255,248,231,.8) }
.y-hb-seg button[aria-pressed='true']{ color:#1A1200; background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%) }
.y-hb-seg button:focus-visible{ outline:2px solid #FFD60A; outline-offset:1px }

/* Tasks */
.y-hb-task{
  display:flex; align-items:flex-start; gap:11px; padding:10px 12px;
  border-radius:14px;
  border:1px solid rgba(255,248,231,.07);
  background:rgba(255,248,231,.022);
  transition:border-color 220ms linear, background 220ms linear, opacity 220ms linear;
}
.y-hb-task-done{ opacity:.5 }
.y-hb-task-doing{ border-color:rgba(255,214,10,.26); background:rgba(255,214,10,.045) }
.y-hb-task-late{ border-color:rgba(255,138,102,.34) }

.y-hb-check{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:22px; height:22px; margin-top:1px; border-radius:7px; cursor:pointer;
  color:#1A1200; background:transparent;
  border:1.5px solid rgba(255,248,231,.24);
  transition:background 200ms linear, border-color 200ms linear, transform 160ms cubic-bezier(.22,1,.36,1);
}
.y-hb-check:hover{ border-color:rgba(255,214,10,.7) }
.y-hb-check:active{ transform:scale(.9) }
.y-hb-check:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-check-doing{
  border-color:#FFC300;
  background:radial-gradient(circle at 50% 50%, #FFC300 0 42%, transparent 43%);
}
.y-hb-check-done{
  border-color:#FFC300; background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
}

.y-hb-sheet::-webkit-scrollbar{ width:0; height:0 }

@keyframes y-hb-rise{
  from{ opacity:0; transform:translateY(9px) }
  to{ opacity:1; transform:none }
}
.y-hb-rise{ animation:y-hb-rise 380ms cubic-bezier(.22,1,.36,1) both }

@media (prefers-reduced-motion: reduce){
  .y-hb-rise{ animation-duration:1ms }
  .y-hb-cta, .y-hb-add, .y-hb-emoji, .y-hb-card, .y-hb-check{ transition-duration:1ms }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Small parts                                                          */
/* ------------------------------------------------------------------ */
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
        fontSize: 9.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: tone === 'gold' ? 'rgba(255,214,10,.72)' : 'rgba(255,248,231,.38)',
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
            boxShadow: '0 0 0 2px #0B0A08',
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
            boxShadow: '0 0 0 2px #0B0A08',
            background: 'rgba(255,248,231,.1)',
            fontFamily: MONO,
            fontSize: 9.5,
            color: 'rgba(255,248,231,.66)',
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
            className={`y-hb-chip${tag.count > 1 ? ' y-hb-chip-shared' : ''}`}
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
            style={{ fontFamily: MONO, fontSize: 10, color: 'rgba(255,248,231,.3)' }}
          >
            +{rest}
          </span>
        ) : null}
      </span>

      <span
        style={{
          display: 'block',
          marginTop: 7,
          fontFamily: SANS,
          fontSize: 11.5,
          lineHeight: 1.4,
          color: 'rgba(255,248,231,.36)',
        }}
      >
        {headcount > 1
          ? `${coverage.totalSkills} soft skills · ${coverage.totalInterests} interests between you` +
            (coverage.shared > 0 ? ` · ${coverage.shared} shared` : '')
          : `${coverage.totalSkills} soft skills · ${coverage.totalInterests} interests so far`}
      </span>
    </span>
  );
}
