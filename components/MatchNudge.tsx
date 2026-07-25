'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchResult, SeedPersona } from '@/lib/types';
import Bubble from './Bubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const EXIT_MS = 380;
const ENTER_MS = 620;

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
@keyframes y-live{
  0%,100%{ opacity:.35; transform:scale(.82) }
  50%    { opacity:1;   transform:scale(1) }
}
.y-live{ animation:y-live 2.6s cubic-bezier(.45,0,.55,1) infinite; }
.y-nudge-go{
  display:inline-flex; align-items:center; justify-content:center;
  height:36px; padding:0 20px; border-radius:12px; border:0; cursor:pointer;
  font-size:14px; font-weight:670; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 22px -8px rgba(255,195,0,.62), inset 0 1px 0 rgba(255,255,255,.6);
  transition:transform 260ms cubic-bezier(.22,1,.36,1),
             box-shadow 260ms cubic-bezier(.22,1,.36,1), filter 180ms linear;
}
.y-nudge-go:hover{ transform:translateY(-1.5px); filter:brightness(1.05);
  box-shadow:0 12px 28px -8px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.7); }
.y-nudge-go:active{ transform:translateY(1px) scale(.985); transition-duration:100ms; }
.y-nudge-go:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px; }
.y-nudge-later{
  display:inline-flex; align-items:center; height:36px; padding:0 12px;
  border:0; background:transparent; cursor:pointer;
  font-size:13.5px; font-weight:550; letter-spacing:-.006em;
  color:rgba(255,248,231,.46);
  transition:color 200ms linear;
}
.y-nudge-later:hover{ color:rgba(255,248,231,.86); }
.y-nudge-later:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; border-radius:8px; }
@media (prefers-reduced-motion: reduce){
  .y-live{ animation:none; opacity:.8 }
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
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40 mx-auto w-full max-w-[420px]"
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
            ? `transform ${ENTER_MS}ms cubic-bezier(.18,1.16,.32,1), opacity 260ms linear`
            : `transform ${EXIT_MS}ms cubic-bezier(.5,0,.75,0), opacity ${EXIT_MS}ms linear`,
          willChange: 'transform',
        }}
      >
        {/* light spilling in from above the phone's edge */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '14%',
            right: '14%',
            top: -8,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(255,195,0,.34)',
            filter: 'blur(20px)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'flex',
            gap: 12,
            padding: '13px 14px 12px 13px',
            borderRadius: 20,
            border: '1px solid rgba(255,214,10,.16)',
            backgroundImage: [
              'radial-gradient(120% 100% at 24% 0%, rgba(255,195,0,.13) 0%, rgba(255,195,0,0) 64%)',
              'linear-gradient(180deg, rgba(28,24,14,.94) 0%, rgba(14,12,8,.95) 100%)',
            ].join(','),
            backdropFilter: 'blur(16px) saturate(1.1)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
            boxShadow:
              '0 24px 60px -22px rgba(0,0,0,.92), inset 0 1px 0 rgba(255,214,10,.24)',
          }}
        >
          <div style={{ flexShrink: 0, paddingTop: 2 }}>
            <Bubble
              profile={person}
              size={42}
              prominence={0.9}
              interactive={false}
              showLabel={false}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 5,
              }}
            >
              <span
                aria-hidden
                className="y-live"
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 9999,
                  background: '#FFD60A',
                  boxShadow: '0 0 8px rgba(255,214,10,.9)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#FFD60A',
                }}
              >
                Strong potential connection
              </span>
            </div>

            <p
              style={{
                fontFamily: SANS,
                fontSize: 14.5,
                fontWeight: 500,
                lineHeight: 1.45,
                letterSpacing: '-0.014em',
                color: '#FFF8E7',
                margin: 0,
              }}
            >
              You and {firstName} overlap on{' '}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 23,
                  height: 23,
                  padding: '0 5px',
                  margin: '0 1px',
                  verticalAlign: '-6px',
                  borderRadius: 9999,
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#1A1300',
                  backgroundImage:
                    'radial-gradient(circle at 34% 26%, #FFE45C 0%, #FFC300 78%)',
                  boxShadow:
                    '0 0 14px rgba(255,214,10,.5), inset 0 1px 0 rgba(255,255,255,.5)',
                }}
              >
                {total}
              </span>{' '}
              skills &amp; interests.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 4,
                marginTop: 11,
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
