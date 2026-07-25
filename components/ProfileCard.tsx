'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchResult, SeedPersona } from '@/lib/types';
import Bubble from './Bubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const EXIT_MS = 440;

export interface ProfileCardProps {
  /** The tapped match. `null`/`undefined` renders nothing. */
  match: MatchResult | null | undefined;
  /** Dismiss — backdrop tap, close button, or Escape. */
  onClose: () => void;
  /** Primary action. The page owns any navigation that follows. */
  onConnect: (person: SeedPersona) => void;
  /** Override the button copy. Defaults to "Connect", or "Message" when connected. */
  ctaLabel?: string;
  /** Already connected — switches the CTA to the quieter outlined treatment. */
  connected?: boolean;
}

function CardStyles() {
  return (
    <style href="yellow-profilecard" precedence="high">{`
@keyframes y-shimmer{
  0%{ transform:translateX(-130%) }
  34%,100%{ transform:translateX(130%) }
}
.y-chip{
  display:inline-flex; align-items:center; height:29px; padding:0 11px;
  border-radius:11px; font-size:12.5px; font-weight:600; line-height:1;
  letter-spacing:-.004em; white-space:nowrap; position:relative; overflow:hidden;
}
.y-chip-on{
  color:#1B1400;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 2px 12px -3px rgba(255,195,0,.5), inset 0 1px 0 rgba(255,255,255,.55);
}
.y-chip-on::after{
  content:''; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(105deg, rgba(255,255,255,0) 36%, rgba(255,255,255,.6) 50%, rgba(255,255,255,0) 64%);
  transform:translateX(-130%);
  animation:y-shimmer 4.8s cubic-bezier(.4,0,.2,1) infinite;
  animation-delay:var(--d,0s);
}
.y-chip-off{
  color:rgba(255,248,231,.52);
  background:rgba(255,248,231,.026);
  border:1px solid rgba(255,214,10,.13);
}
.y-cta{
  width:100%; height:54px; border-radius:16px; border:0; cursor:pointer;
  font-size:16px; font-weight:680; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 12px 32px -12px rgba(255,195,0,.62), inset 0 1px 0 rgba(255,255,255,.62);
  transition:transform 280ms cubic-bezier(.22,1,.36,1),
             box-shadow 280ms cubic-bezier(.22,1,.36,1),
             filter 200ms linear, background 200ms linear;
}
.y-cta:hover{ transform:translateY(-1.5px); filter:brightness(1.05);
  box-shadow:0 18px 40px -12px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.7); }
.y-cta:active{ transform:translateY(1px) scale(.993); transition-duration:110ms; }
.y-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px; }
.y-cta-alt{
  color:#FFD60A; background:rgba(255,214,10,.05);
  border:1px solid rgba(255,214,10,.42); box-shadow:none;
}
.y-cta-alt:hover{ background:rgba(255,214,10,.1);
  box-shadow:0 12px 30px -16px rgba(255,195,0,.6); }
.y-close{
  display:inline-flex; align-items:center; justify-content:center;
  width:32px; height:32px; border-radius:9999px; cursor:pointer;
  color:rgba(255,248,231,.44); background:transparent;
  border:1px solid rgba(255,248,231,.1);
  transition:color 200ms linear, border-color 200ms linear, background 200ms linear;
}
.y-close:hover{ color:#FFF8E7; border-color:rgba(255,214,10,.4); background:rgba(255,214,10,.06); }
.y-close:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }
.y-sheet::-webkit-scrollbar{ width:0; height:0 }
@media (prefers-reduced-motion: reduce){
  .y-chip-on::after{ animation:none; opacity:0 }
  .y-cta{ transition-duration:1ms }
}
`}</style>
  );
}

const norm = (s: string) => s.trim().toLowerCase();

function Chip({ label, shared, i }: { label: string; shared: boolean; i: number }) {
  return (
    <span
      className={shared ? 'y-chip y-chip-on' : 'y-chip y-chip-off'}
      style={
        shared
          ? ({ ['--d' as string]: `${(i % 6) * 0.42}s`, fontFamily: SANS })
          : { fontFamily: SANS }
      }
    >
      {label}
    </span>
  );
}

function Group({
  title,
  items,
  sharedSet,
  offset,
}: {
  title: string;
  items: string[];
  sharedSet: Set<string>;
  offset: number;
}) {
  if (!items.length) return null;
  const ordered = [...items].sort(
    (a, b) => Number(sharedSet.has(norm(b))) - Number(sharedSet.has(norm(a)))
  );
  const count = ordered.filter((t) => sharedSet.has(norm(t))).length;

  return (
    <section style={{ marginTop: 20 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 11,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(255,248,231,.4)',
          }}
        >
          {title}
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            height: 1,
            background:
              'linear-gradient(90deg, rgba(255,214,10,.18), rgba(255,214,10,.02))',
          }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: count ? '#FFD60A' : 'rgba(255,248,231,.28)',
          }}
        >
          {count} shared
        </span>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {ordered.map((t, i) => (
          <Chip
            key={`${t}-${i}`}
            label={t}
            shared={sharedSet.has(norm(t))}
            i={offset + i}
          />
        ))}
      </div>
    </section>
  );
}

export default function ProfileCard({
  match,
  onClose,
  onConnect,
  ctaLabel,
  connected = false,
}: ProfileCardProps) {
  const [shown, setShown] = useState<MatchResult | null>(match ?? null);
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (match) {
      setShown(match);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setOpen(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setOpen(false);
    const t = setTimeout(() => setShown(null), EXIT_MS);
    return () => clearTimeout(t);
  }, [match]);

  useEffect(() => {
    if (!match) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [match]);

  useEffect(() => {
    if (open) sheetRef.current?.focus({ preventScroll: true });
  }, [open]);

  const handleConnect = useCallback(() => {
    if (shown?.person) onConnect(shown.person);
  }, [shown, onConnect]);

  if (!shown?.person) return null;

  const person = shown.person;
  const sharedSkills = shown.sharedSkills ?? [];
  const sharedInterests = shown.sharedInterests ?? [];
  const total = sharedSkills.length + sharedInterests.length;
  const skillSet = new Set(sharedSkills.map(norm));
  const interestSet = new Set(sharedInterests.map(norm));

  const tail =
    total === 1
      ? 'thing in common'
      : total === 0
        ? 'in common — say hello anyway'
        : 'skills & interests';

  const label = ctaLabel ?? (connected ? 'Message' : 'Connect');

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ pointerEvents: open ? 'auto' : 'none' }}
    >
      <CardStyles />

      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(5,4,2,.66)',
          backdropFilter: 'blur(4px) saturate(.85)',
          WebkitBackdropFilter: 'blur(4px) saturate(.85)',
          opacity: open ? 1 : 0,
          transition: 'opacity 420ms cubic-bezier(.22,1,.36,1)',
        }}
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} — what you share`}
        tabIndex={-1}
        className="y-sheet absolute bottom-0 left-0 right-0 mx-auto w-full max-w-[420px] outline-none"
        style={{
          maxHeight: '88dvh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          padding: '14px 22px 26px',
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          borderTop: '1px solid rgba(255,214,10,.18)',
          backgroundImage: [
            'radial-gradient(120% 62% at 50% 0%, rgba(255,195,0,.10) 0%, rgba(255,195,0,0) 62%)',
            'linear-gradient(180deg, #17140C 0%, #100E09 40%, #0B0A08 100%)',
          ].join(','),
          boxShadow: '0 -30px 90px -26px rgba(255,178,0,.22)',
          transform: open ? 'translateY(0)' : 'translateY(102%)',
          transition: `transform ${EXIT_MS}ms cubic-bezier(.22,1,.36,1)`,
          willChange: 'transform',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 38,
            height: 4,
            borderRadius: 99,
            background: 'rgba(255,248,231,.2)',
            margin: '0 auto 18px',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <Bubble
            profile={person}
            size={62}
            prominence={0.95}
            interactive={false}
            showLabel={false}
          />
          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
            <h2
              style={{
                fontFamily: SANS,
                fontSize: 21,
                fontWeight: 680,
                letterSpacing: '-0.024em',
                lineHeight: 1.15,
                color: '#FFF8E7',
                margin: 0,
              }}
            >
              {person.name}
            </h2>
            <p
              style={{
                fontFamily: SANS,
                fontSize: 13.5,
                lineHeight: 1.4,
                letterSpacing: '-0.006em',
                color: 'rgba(255,248,231,.5)',
                margin: '5px 0 0',
              }}
            >
              {person.tagline}
            </p>
          </div>
          <button
            type="button"
            className="y-close"
            onClick={onClose}
            aria-label="Close"
            style={{ flexShrink: 0, marginTop: 2 }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
              <path
                d="M1 1l11 11M12 1L1 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* The pitch line. The number is a bubble — same object language as
            the field it came from. */}
        <p
          style={{
            fontFamily: SANS,
            fontSize: 25,
            fontWeight: 560,
            letterSpacing: '-0.028em',
            lineHeight: 1.42,
            color: '#FFF8E7',
            margin: '26px 0 2px',
          }}
        >
          You share{' '}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 46,
              height: 46,
              margin: '0 5px',
              verticalAlign: '-13px',
              borderRadius: 9999,
              position: 'relative',
              overflow: 'hidden',
              fontFamily: MONO,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: total ? '#1A1300' : 'rgba(255,248,231,.55)',
              backgroundImage: total
                ? [
                    'radial-gradient(circle at 32% 24%, rgba(255,255,255,.62) 0%, rgba(255,255,255,0) 46%)',
                    'radial-gradient(circle at 34% 26%, #FFE45C 0%, #FFC300 76%)',
                  ].join(',')
                : 'linear-gradient(180deg, rgba(255,248,231,.08), rgba(255,248,231,.03))',
              boxShadow: total
                ? '0 0 26px rgba(255,214,10,.42), 0 0 60px rgba(255,178,0,.2), inset 0 1px 0 rgba(255,255,255,.5)'
                : 'inset 0 0 0 1px rgba(255,248,231,.12)',
            }}
          >
            {total}
          </span>{' '}
          {tail}
        </p>

        <Group
          title="Soft skills"
          items={person.softSkills ?? []}
          sharedSet={skillSet}
          offset={0}
        />
        <Group
          title="Interests"
          items={person.interests ?? []}
          sharedSet={interestSet}
          offset={3}
        />

        <div style={{ marginTop: 26 }}>
          <button
            type="button"
            onClick={handleConnect}
            className={connected ? 'y-cta y-cta-alt' : 'y-cta'}
            style={{ fontFamily: SANS }}
          >
            {label}
          </button>
          <p
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              textAlign: 'center',
              color: 'rgba(255,248,231,.26)',
              margin: '13px 0 0',
            }}
          >
            {connected ? 'Already connected' : 'Both of you have to say yes'}
          </p>
        </div>
      </div>
    </div>
  );
}
