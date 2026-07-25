'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { mulberry32 } from './VoiceNoteBubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const CONFETTI = ['#FFD60A', '#FFE45C', '#FFC300', '#FFF8E7', '#FF9F1C', '#B8860B'];
const PARTICLE_COUNT = 36;

function CelebrationStyles() {
  return (
    <style href="yellow-celebration" precedence="high">{`
.y-cel{ position:fixed; inset:0; z-index:60; display:flex; overflow:hidden }
/* Opaque on purpose: the unlock deserves a clean stage, not a peek at the
   thread you just finished. */
.y-cel-scrim{
  position:absolute; inset:0;
  background-color:#080704;
  background-image:radial-gradient(115% 68% at 50% 40%, rgba(126,88,0,.55) 0%, rgba(8,7,4,0) 64%);
  animation:y-cel-fade 420ms ease forwards;
}
@keyframes y-cel-fade{ from{ opacity:0 } to{ opacity:1 } }
.y-cel-col{
  position:relative; margin:0 auto; width:100%; max-width:420px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:0 26px; text-align:center;
}
.y-cel-stage{ position:relative; height:104px; width:100%; display:flex;
  align-items:center; justify-content:center }
.y-cel-face{
  position:relative; width:76px; height:76px; border-radius:9999px;
  display:flex; align-items:center; justify-content:center; font-size:33px;
  box-shadow:0 14px 40px -14px rgba(0,0,0,.9), inset 0 2px 0 rgba(255,255,255,.4);
}
.y-cel-face-a{ animation:y-cel-in-l 780ms cubic-bezier(.2,1.35,.4,1) 120ms backwards; margin-right:-14px }
.y-cel-face-b{ animation:y-cel-in-r 780ms cubic-bezier(.2,1.35,.4,1) 120ms backwards; margin-left:-14px }
@keyframes y-cel-in-l{ from{ transform:translateX(-130px) scale(.6); opacity:0 } }
@keyframes y-cel-in-r{ from{ transform:translateX(130px) scale(.6); opacity:0 } }
.y-cel-ring{
  position:absolute; left:50%; top:50%; width:120px; height:120px; margin:-60px 0 0 -60px;
  border-radius:9999px; border:2px solid #FFD60A; opacity:0;
  animation:y-cel-ring 900ms cubic-bezier(.16,.8,.3,1) 760ms forwards;
}
@keyframes y-cel-ring{
  0%{ transform:scale(.3); opacity:.95 }
  100%{ transform:scale(2.7); opacity:0 }
}
.y-cel-burst{ position:absolute; left:50%; top:50%; width:0; height:0; pointer-events:none }
.y-cel-p{
  position:absolute; left:0; top:0; border-radius:2px; opacity:0;
  animation:y-cel-p var(--dur) cubic-bezier(.1,.62,.3,1) var(--delay) forwards;
}
@keyframes y-cel-p{
  0%{ transform:translate3d(0,0,0) scale(.2) rotate(0deg); opacity:0 }
  10%{ opacity:1 }
  70%{ transform:translate3d(var(--tx), var(--ty), 0) scale(1) rotate(var(--rot)); opacity:1 }
  100%{ transform:translate3d(var(--tx), calc(var(--ty) + 92px), 0) scale(.85) rotate(var(--rot)); opacity:0 }
}
.y-cel-eyebrow{
  font-size:10px; letter-spacing:.28em; text-transform:uppercase;
  color:#FFD60A; margin:30px 0 0;
  animation:y-cel-rise 620ms cubic-bezier(.22,1,.36,1) 820ms backwards;
}
.y-cel-h1{
  margin:11px 0 0; font-size:38px; font-weight:660; line-height:1.03;
  letter-spacing:-.042em; color:#FFF8E7;
  animation:y-cel-rise 720ms cubic-bezier(.22,1,.36,1) 900ms backwards;
}
.y-cel-sub{
  margin:15px 0 0; max-width:19em; font-size:14.5px; line-height:1.55;
  letter-spacing:-.006em; color:rgba(255,248,231,.6);
  animation:y-cel-rise 720ms cubic-bezier(.22,1,.36,1) 1000ms backwards;
}
@keyframes y-cel-rise{ from{ transform:translateY(14px); opacity:0 } }
.y-cel-actions{
  width:100%; margin-top:34px; display:flex; flex-direction:column; align-items:center; gap:14px;
  animation:y-cel-rise 720ms cubic-bezier(.22,1,.36,1) 1120ms backwards;
}
.y-cel-cta{
  display:flex; align-items:center; justify-content:center; gap:9px;
  width:100%; height:54px; border-radius:16px; text-decoration:none;
  font-size:16px; font-weight:680; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 12px 32px -12px rgba(255,195,0,.72), inset 0 1px 0 rgba(255,255,255,.62);
  transition:transform 260ms cubic-bezier(.22,1,.36,1), filter 180ms linear;
}
.y-cel-cta:hover{ transform:translateY(-1.5px); filter:brightness(1.05) }
.y-cel-cta:active{ transform:translateY(1px) scale(.994) }
.y-cel-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-cel-quiet{
  border:0; background:none; cursor:pointer; text-decoration:none;
  font-size:9.5px; letter-spacing:.16em; text-transform:uppercase;
  color:rgba(255,248,231,.34); transition:color 180ms linear;
}
.y-cel-quiet:hover{ color:#FFD60A }
.y-cel-quiet:focus-visible{ outline:2px solid #FFD60A; outline-offset:3px; border-radius:4px }
@media (prefers-reduced-motion: reduce){
  .y-cel-face-a,.y-cel-face-b,.y-cel-eyebrow,.y-cel-h1,.y-cel-sub,.y-cel-actions{ animation-duration:1ms }
  .y-cel-ring{ animation:none }
  .y-cel-p{ animation:y-cel-still 900ms ease forwards var(--delay) }
}
@keyframes y-cel-still{ 0%{ opacity:0 } 40%{ opacity:.9 } 100%{ opacity:0 } }
`}</style>
  );
}

interface Face {
  emoji: string;
  gradient: readonly [string, string];
  name: string;
}

export interface CelebrationProps {
  /** The person on the other side of the exchange. */
  person: Face;
  /** You. Falls back to a plain yellow bubble when the profile isn't loaded. */
  me?: Partial<Face> | null;
  /** Where "Say hi" goes — normally `/chat/[id]`. */
  href: string;
  /** Override the primary action label. */
  ctaLabel?: string;
  /** Renders a quiet secondary action when provided. */
  onDismiss?: () => void;
  /** Label for that secondary action. */
  dismissLabel?: string;
}

export default function Celebration({
  person,
  me,
  href,
  ctaLabel = 'Say hi',
  onDismiss,
  dismissLabel = 'Not right now',
}: CelebrationProps) {
  const ctaRef = useRef<HTMLAnchorElement | null>(null);

  const particles = useMemo(() => {
    const rnd = mulberry32(0x7e110);
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + rnd() * 0.5;
      const distance = 84 + rnd() * 175;
      const width = 4 + rnd() * 7;
      return {
        tx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
        ty: `${(Math.sin(angle) * distance - 34).toFixed(1)}px`,
        rot: `${Math.round(rnd() * 900 - 450)}deg`,
        dur: `${(1.35 + rnd() * 1.15).toFixed(2)}s`,
        delay: `${(0.76 + rnd() * 0.34).toFixed(2)}s`,
        width,
        height: rnd() > 0.55 ? width : width * (1.6 + rnd()),
        color: CONFETTI[Math.floor(rnd() * CONFETTI.length)],
      };
    });
  }, []);

  // The unlock is the point of the screen — put the keyboard there too.
  useEffect(() => {
    const timer = window.setTimeout(() => ctaRef.current?.focus({ preventScroll: true }), 1400);
    return () => window.clearTimeout(timer);
  }, []);

  const myFace: Face = {
    emoji: me?.emoji ?? '🟡',
    gradient: me?.gradient ?? ['#FFE45C', '#FFC300'],
    name: me?.name ?? 'You',
  };

  return (
    <div
      className="y-cel"
      role="dialog"
      aria-modal="true"
      aria-label={`You're connected with ${person.name}`}
    >
      <CelebrationStyles />
      <div className="y-cel-scrim" aria-hidden />

      <div className="y-cel-col" style={{ fontFamily: SANS }}>
        <div className="y-cel-stage">
          <div className="y-cel-ring" aria-hidden />

          <div
            className="y-cel-face y-cel-face-a"
            aria-hidden
            style={{
              backgroundImage: `radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%), linear-gradient(150deg, ${myFace.gradient[0]}, ${myFace.gradient[1]})`,
            }}
          >
            {myFace.emoji}
          </div>
          <div
            className="y-cel-face y-cel-face-b"
            aria-hidden
            style={{
              backgroundImage: `radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%), linear-gradient(150deg, ${person.gradient[0]}, ${person.gradient[1]})`,
            }}
          >
            {person.emoji}
          </div>

          <div className="y-cel-burst" aria-hidden>
            {particles.map((p, i) => (
              <span
                key={i}
                className="y-cel-p"
                style={
                  {
                    width: p.width,
                    height: p.height,
                    background: p.color,
                    ['--tx']: p.tx,
                    ['--ty']: p.ty,
                    ['--rot']: p.rot,
                    ['--dur']: p.dur,
                    ['--delay']: p.delay,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>

        <p className="y-cel-eyebrow" style={{ fontFamily: MONO }}>
          Both intros in
        </p>
        <h1 className="y-cel-h1">You&rsquo;re connected!</h1>
        <p className="y-cel-sub">
          This is the first step to a meaningful working relationship.
        </p>

        <div className="y-cel-actions">
          <Link className="y-cel-cta" href={href} ref={ctaRef}>
            {ctaLabel}
            <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden>
              <path
                d="M1 6h12M8.6 1.4 13.2 6l-4.6 4.6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </Link>
          {onDismiss ? (
            <button
              type="button"
              className="y-cel-quiet"
              style={{ fontFamily: MONO }}
              onClick={onDismiss}
            >
              {dismissLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
