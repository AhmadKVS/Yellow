'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchResult, SeedPersona } from '@/lib/types';
import Bubble from './Bubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const EXIT_MS = 380;
const ENTER_MS = 420;
/* Apple's sheet/banner curve. */
const EASE = 'cubic-bezier(.32,.72,0,1)';

export interface MatchNudgeProps {
  /** The suggested match. `null`/`undefined` renders nothing. */
  match: MatchResult | null | undefined;
  /** Primary action. The page owns any navigation that follows. */
  onConnect: (person: SeedPersona) => void;
  /** "Later", the backdrop-free dismiss, and Escape all route here. */
  onDismiss: () => void;
  connectLabel?: string;
  dismissLabel?: string;
}

function NudgeStyles() {
  return (
    <style href="yellow-nudge" precedence="high">{`
.y-nudge-go{
  display:inline-flex; align-items:center; justify-content:center;
  height:34px; padding:0 18px; border-radius:9999px; border:0; cursor:pointer;
  font-size:14px; font-weight:600; letter-spacing:-.01em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  transition:transform 120ms ${EASE}, filter 120ms linear;
}
.y-nudge-go:hover{ filter:brightness(1.04); }
.y-nudge-go:active{ transform:scale(.97); }
.y-nudge-go:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }
.y-nudge-later{
  display:inline-flex; align-items:center; height:34px; padding:0 12px;
  border:0; border-radius:9999px; background:transparent; cursor:pointer;
  font-size:14px; font-weight:500; letter-spacing:-.01em;
  color:rgba(255,248,231,.62);
  transition:color 160ms linear;
}
.y-nudge-later:hover{ color:#FFD60A; }
.y-nudge-later:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }
.y-nudge-glass{
  background:rgba(20,17,10,.70);
  backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){
  .y-nudge-glass{ background:rgba(14,12,7,.97) }
}
@media (prefers-reduced-motion: reduce){
  .y-nudge-go{ transition-duration:1ms }
}
`}</style>
  );
}

export default function MatchNudge({
  match,
  onConnect,
  onDismiss,
  connectLabel = 'Connect',
  dismissLabel = 'Later',
}: MatchNudgeProps) {
  const [shown, setShown] = useState<MatchResult | null>(match ?? null);
  const [open, setOpen] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

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
      if (e.key === 'Escape') onDismissRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [match]);

  const handleConnect = useCallback(() => {
    if (shown?.person) onConnect(shown.person);
  }, [shown, onConnect]);

  if (!shown?.person) return null;

  const person = shown.person;
  const total =
    (shown.sharedSkills?.length ?? 0) + (shown.sharedInterests?.length ?? 0);
  const firstName = (person.name ?? '').trim().split(/\s+/)[0] || person.name;

  return (
    /* Absolute, not fixed: the host pins this to the top of the map, so on a
       wide window the banner centres over the canvas instead of straddling
       the sidebar and covering the page header. */
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-40 mx-auto w-full max-w-[420px]"
      style={{ padding: '12px 12px 0' }}
    >
      <NudgeStyles />

      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'relative',
          pointerEvents: open ? 'auto' : 'none',
          transform: open ? 'translateY(0)' : 'translateY(-134%)',
          opacity: open ? 1 : 0,
          transition: open
            ? `transform ${ENTER_MS}ms ${EASE}, opacity 200ms linear`
            : `transform ${EXIT_MS}ms ${EASE}, opacity ${EXIT_MS}ms linear`,
          willChange: 'transform',
        }}
      >
        <div
          className="y-nudge-glass"
          style={{
            position: 'relative',
            display: 'flex',
            gap: 12,
            padding: '12px 14px 11px 12px',
            borderRadius: 22,
            border: '1px solid rgba(255,255,255,.14)',
            boxShadow:
              '0 10px 30px -12px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.05)',
          }}
        >
          <div style={{ flexShrink: 0, paddingTop: 3 }}>
            <Bubble
              profile={person}
              size={38}
              prominence={0.9}
              interactive={false}
              showLabel={false}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(255,214,10,.8)',
                margin: '1px 0 0',
              }}
            >
              Strong match
            </p>

            <p
              style={{
                fontFamily: SANS,
                fontSize: 15,
                fontWeight: 400,
                lineHeight: 1.42,
                letterSpacing: '-0.006em',
                color: '#FFF8E7',
                margin: '5px 0 0',
              }}
            >
              You and {firstName} overlap on{' '}
              <span style={{ fontWeight: 600, color: '#FFD60A' }}>{total}</span>{' '}
              skills &amp; interests.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 4,
                marginTop: 10,
              }}
            >
              <button
                type="button"
                className="y-nudge-later"
                onClick={onDismiss}
                style={{ fontFamily: SANS }}
              >
                {dismissLabel}
              </button>
              <button
                type="button"
                className="y-nudge-go"
                onClick={handleConnect}
                style={{ fontFamily: SANS }}
              >
                {connectLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
