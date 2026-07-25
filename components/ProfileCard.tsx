'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchResult, SeedPersona } from '@/lib/types';
import Bubble from './Bubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const EXIT_MS = 440;
/* Apple's sheet curve. */
const SHEET_EASE = 'cubic-bezier(.32,.72,0,1)';

export interface ProfileCardProps {
  /** The tapped match. `null`/`undefined` renders nothing. */
  match: MatchResult | null | undefined;
  /** Dismiss — backdrop tap, close button, or Escape. */
  onClose: () => void;
  /** Primary action. The page owns any navigation that follows. */
  onConnect: (person: SeedPersona) => void;
  /** Override the button copy. Defaults to "Connect", or "Message" when connected. */
  ctaLabel?: string;
  /** Already connected — switches the CTA to the quieter tinted treatment. */
  connected?: boolean;
}

function CardStyles() {
  return (
    <style href="yellow-profilecard" precedence="high">{`
.y-chip{
  display:inline-flex; align-items:center; height:30px; padding:0 12px;
  border-radius:10px; font-size:13px; font-weight:500; line-height:1;
  letter-spacing:-.006em; white-space:nowrap;
}
.y-chip-on{
  color:#FFD60A;
  background:rgba(255,214,10,.13);
  border:1px solid rgba(255,214,10,.22);
}
.y-chip-off{
  color:rgba(255,248,231,.40);
  background:transparent;
  border:1px solid rgba(255,255,255,.08);
}
.y-cta{
  display:flex; align-items:center; justify-content:center;
  width:100%; height:50px; border-radius:9999px; border:0; cursor:pointer;
  font-size:15px; font-weight:600; letter-spacing:-.01em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55);
  transition:transform 120ms ${SHEET_EASE}, filter 120ms linear,
             background 160ms linear;
}
.y-cta:hover{ filter:brightness(1.04); }
.y-cta:active{ transform:scale(.97); }
.y-cta:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }
.y-cta-alt{
  color:#FFD60A; background:rgba(255,214,10,.13);
  border:1px solid rgba(255,214,10,.22); box-shadow:none;
}
.y-cta-alt:hover{ background:rgba(255,214,10,.2); filter:none; }
.y-close{
  display:inline-flex; align-items:center; justify-content:center;
  width:44px; height:44px; margin:-7px -12px 0 0; padding:0;
  border:0; background:transparent; cursor:pointer;
}
.y-close span{
  display:inline-flex; align-items:center; justify-content:center;
  width:30px; height:30px; border-radius:9999px;
  color:rgba(255,248,231,.55); background:rgba(255,255,255,.08);
  transition:color 160ms linear, background 160ms linear;
}
.y-close:hover span{ color:#FFF8E7; background:rgba(255,255,255,.14); }
.y-close:focus-visible{ outline:2px solid #FFD60A; outline-offset:-6px; border-radius:9999px; }
.y-sheet{
  background:rgba(20,17,10,.70);
  backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){
  .y-sheet{ background:rgba(14,12,7,.97) }
}
.y-sheet::-webkit-scrollbar{ width:0; height:0 }
@media (prefers-reduced-motion: reduce){
  .y-cta{ transition-duration:1ms }
}
`}</style>
  );
}

const norm = (s: string) => s.trim().toLowerCase();

function Chip({ label, shared }: { label: string; shared: boolean }) {
  return (
    <span
      className={shared ? 'y-chip y-chip-on' : 'y-chip y-chip-off'}
      style={{ fontFamily: SANS }}
    >
      {label}
    </span>
  );
}

const EYEBROW: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};

function Group({
  title,
  items,
  sharedSet,
}: {
  title: string;
  items: string[];
  sharedSet: Set<string>;
}) {
  if (!items.length) return null;
  const ordered = [...items].sort(
    (a, b) => Number(sharedSet.has(norm(b))) - Number(sharedSet.has(norm(a)))
  );
  const count = ordered.filter((t) => sharedSet.has(norm(t))).length;

  return (
    <section style={{ marginTop: 22 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <span style={{ ...EYEBROW, color: 'rgba(255,248,231,.40)' }}>
          {title}
        </span>
        <span
          style={{
            ...EYEBROW,
            color: count ? 'rgba(255,214,10,.8)' : 'rgba(255,248,231,.26)',
          }}
        >
          {count} shared
        </span>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {ordered.map((t, i) => (
          <Chip key={`${t}-${i}`} label={t} shared={sharedSet.has(norm(t))} />
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

  /* `tagline` is usually a truncated excerpt of `bio`, so printing both puts
     the same opening sentence on screen twice, once cut off. When it is an
     excerpt the full text below is strictly better; only a tagline that says
     something new earns its own line. */
  const bio = person.bio?.trim() ?? '';
  const tagline = (person.tagline ?? '').trim();
  const stem = tagline.replace(/[\s.…]+$/u, '').toLowerCase();
  const showTagline =
    Boolean(tagline) && !(stem.length > 0 && bio.toLowerCase().startsWith(stem));

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
          background: 'rgba(0,0,0,.5)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          opacity: open ? 1 : 0,
          transition: `opacity 420ms ${SHEET_EASE}`,
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
          padding: '10px 20px 28px',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderTop: '1px solid rgba(255,255,255,.14)',
          boxShadow:
            '0 -20px 60px -20px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.05)',
          transform: open ? 'translateY(0)' : 'translateY(102%)',
          transition: `transform ${EXIT_MS}ms ${SHEET_EASE}`,
          willChange: 'transform',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 5,
            borderRadius: 9999,
            background: 'rgba(255,248,231,.22)',
            margin: '0 auto 20px',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <Bubble
            profile={person}
            size={60}
            prominence={0.9}
            interactive={false}
            showLabel={false}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              /* with no tagline the name is the only line, so centre it on
                 the avatar instead of letting it hang from the top */
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: 60,
              paddingTop: showTagline ? 3 : 0,
            }}
          >
            <h2
              style={{
                fontFamily: SANS,
                fontSize: 21,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                lineHeight: 1.18,
                color: '#FFF8E7',
                margin: 0,
              }}
            >
              {person.name}
            </h2>
            {showTagline ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  fontWeight: 400,
                  lineHeight: 1.42,
                  color: 'rgba(255,248,231,.62)',
                  margin: '4px 0 0',
                }}
              >
                {tagline}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="y-close"
            onClick={onClose}
            aria-label="Close"
            style={{ flexShrink: 0 }}
          >
            <span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M1.2 1.2 10.8 10.8M10.8 1.2 1.2 10.8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </button>
        </div>

        {bio ? (
          <p
            style={{
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: 400,
              lineHeight: 1.5,
              color: 'rgba(255,248,231,.62)',
              margin: '18px 0 0',
              whiteSpace: 'pre-wrap',
            }}
          >
            {bio}
          </p>
        ) : null}

        <div style={{ marginTop: 24 }}>
          <p style={{ ...EYEBROW, color: 'rgba(255,248,231,.40)', margin: 0 }}>
            Overlap
          </p>
          <p
            style={{
              fontFamily: SANS,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.28,
              color: '#FFF8E7',
              margin: '7px 0 0',
            }}
          >
            You share{' '}
            <span style={{ color: total ? '#FFD60A' : 'rgba(255,248,231,.40)' }}>
              {total}
            </span>{' '}
            {tail}
          </p>
        </div>

        <Group
          title="Soft skills"
          items={person.softSkills ?? []}
          sharedSet={skillSet}
        />
        <Group
          title="Interests"
          items={person.interests ?? []}
          sharedSet={interestSet}
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
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 400,
              textAlign: 'center',
              color: 'rgba(255,248,231,.40)',
              margin: '12px 0 0',
            }}
          >
            {connected ? 'Already connected' : 'Both of you have to say yes'}
          </p>
        </div>
      </div>
    </div>
  );
}
