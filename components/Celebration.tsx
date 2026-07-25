'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { initialsFor } from '@/lib/initials';
import { mulberry32 } from './VoiceNoteBubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const CONFETTI = ['#FFD60A', '#FFE45C', '#FFC300', '#FFF8E7'];
const PARTICLE_COUNT = 20;

function CelebrationStyles() {
  return (
    <style href="yellow-celebration" precedence="high">{`
.y-cel{ position:fixed; inset:0; z-index:60; display:flex; overflow:hidden }
/* Chrome glass, taken full-screen: the thread behind reads as depth rather
   than as content — the unlock deserves a clean stage.  */
.y-cel-scrim{
  position:absolute; inset:0;
  background-color:rgba(20,17,10,.76);
  background-image:radial-gradient(108% 62% at 50% 38%, rgba(255,199,0,.15) 0%, rgba(5,4,3,0) 62%);
  backdrop-filter:blur(28px) saturate(1.4);
  -webkit-backdrop-filter:blur(28px) saturate(1.4);
  animation:y-cel-fade 380ms cubic-bezier(.32,.72,0,1) forwards;
}
@supports not (backdrop-filter: blur(1px)){
  .y-cel-scrim{ background-color:rgba(8,7,4,.97) }
}
@keyframes y-cel-fade{ from{ opacity:0 } to{ opacity:1 } }
.y-cel-col{
  position:relative; margin:0 auto; width:100%; max-width:400px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:0 26px; text-align:center;
}
.y-cel-stage{ position:relative; height:104px; width:100%; display:flex;
  align-items:center; justify-content:center }
.y-cel-face{
  position:relative; width:76px; height:76px; border-radius:9999px; overflow:hidden;
  display:flex; align-items:center; justify-content:center; line-height:1;
  box-shadow:0 14px 40px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.4);
}
/* A portrait is an <img>, which paints over the disc's inset hairline — so the
   rim is drawn on top instead. Photos keep the rim; monograms keep it too. */
.y-cel-face::after{
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16), inset 0 1px 0 rgba(255,255,255,.3);
}
.y-cel-mono{
  font-weight:600; letter-spacing:.02em; color:#FFF8E7;
  text-shadow:0 1px 5px rgba(0,0,0,.45);
}
/* Overlapped, but never far enough to eat the monogram behind — and the front
   disc carries a canvas-coloured rim so the two edges stay legible. */
.y-cel-face-a{ animation:y-cel-in-l 640ms cubic-bezier(.32,.72,0,1) 120ms backwards; margin-right:-8px }
.y-cel-face-b{
  animation:y-cel-in-r 640ms cubic-bezier(.32,.72,0,1) 120ms backwards; margin-left:-8px;
  box-shadow:0 0 0 3px rgba(10,8,4,.9), 0 14px 40px -16px rgba(0,0,0,.9),
             inset 0 1px 0 rgba(255,255,255,.4);
}
@keyframes y-cel-in-l{ from{ transform:translateX(-110px) scale(.7); opacity:0 } }
@keyframes y-cel-in-r{ from{ transform:translateX(110px) scale(.7); opacity:0 } }
.y-cel-ring{
  position:absolute; left:50%; top:50%; width:120px; height:120px; margin:-60px 0 0 -60px;
  border-radius:9999px; border:1.5px solid rgba(255,214,10,.85); opacity:0;
  animation:y-cel-ring 820ms cubic-bezier(.32,.72,0,1) 700ms forwards;
}
@keyframes y-cel-ring{
  0%{ transform:scale(.35); opacity:.9 }
  100%{ transform:scale(2.5); opacity:0 }
}
.y-cel-burst{ position:absolute; left:50%; top:50%; width:0; height:0; pointer-events:none }
.y-cel-p{
  position:absolute; left:0; top:0; border-radius:1.5px; opacity:0;
  animation:y-cel-p var(--dur) cubic-bezier(.1,.62,.3,1) var(--delay) forwards;
}
@keyframes y-cel-p{
  0%{ transform:translate3d(0,0,0) scale(.2) rotate(0deg); opacity:0 }
  12%{ opacity:1 }
  70%{ transform:translate3d(var(--tx), var(--ty), 0) scale(1) rotate(var(--rot)); opacity:.95 }
  100%{ transform:translate3d(var(--tx), calc(var(--ty) + 84px), 0) scale(.8) rotate(var(--rot)); opacity:0 }
}
.y-cel-eyebrow{
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,214,10,.78); margin:30px 0 0;
  animation:y-cel-rise 520ms cubic-bezier(.32,.72,0,1) 760ms backwards;
}
.y-cel-h1{
  margin:12px 0 0; font-size:30px; font-weight:700; line-height:1.1;
  letter-spacing:-.03em; color:#FFF8E7;
  animation:y-cel-rise 560ms cubic-bezier(.32,.72,0,1) 840ms backwards;
}
.y-cel-sub{
  margin:13px 0 0; max-width:21em; font-size:15px; line-height:1.5;
  color:rgba(255,248,231,.62);
  animation:y-cel-rise 560ms cubic-bezier(.32,.72,0,1) 920ms backwards;
}
@keyframes y-cel-rise{ from{ transform:translateY(12px); opacity:0 } }
.y-cel-actions{
  width:100%; margin-top:32px; display:flex; flex-direction:column; align-items:center; gap:16px;
  animation:y-cel-rise 560ms cubic-bezier(.32,.72,0,1) 1020ms backwards;
}
.y-cel-cta{
  display:flex; align-items:center; justify-content:center; gap:9px;
  width:100%; height:50px; border-radius:9999px; text-decoration:none;
  font-size:15px; font-weight:600; letter-spacing:-.01em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55), inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform 120ms cubic-bezier(.32,.72,0,1), filter 160ms linear;
}
.y-cel-cta:hover{ filter:brightness(1.04) }
.y-cel-cta:active{ transform:scale(.97) }
.y-cel-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:2px }
.y-cel-quiet{
  border:0; background:none; cursor:pointer; text-decoration:none; padding:4px 2px;
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,248,231,.4); transition:color 180ms linear;
}
.y-cel-quiet:hover{ color:#FFD60A }
.y-cel-quiet:focus-visible{ outline:2px solid #FFD60A; outline-offset:3px; border-radius:4px }
@media (prefers-reduced-motion: reduce){
  .y-cel-face-a,.y-cel-face-b,.y-cel-eyebrow,.y-cel-h1,.y-cel-sub,.y-cel-actions{ animation-duration:1ms }
  .y-cel-ring{ animation:none }
  .y-cel-cta{ transition-duration:1ms }
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
  /** Real photo when they've uploaded one; the emoji is the fallback. */
  photoUrl?: string;
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
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + rnd() * 0.45;
      const distance = 88 + rnd() * 150;
      const width = 3 + rnd() * 4;
      return {
        tx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
        ty: `${(Math.sin(angle) * distance - 30).toFixed(1)}px`,
        rot: `${Math.round(rnd() * 720 - 360)}deg`,
        dur: `${(1.3 + rnd() * 0.9).toFixed(2)}s`,
        delay: `${(0.7 + rnd() * 0.3).toFixed(2)}s`,
        width,
        height: rnd() > 0.5 ? width : width * (1.8 + rnd()),
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
    emoji: me?.emoji ?? '',
    gradient: me?.gradient ?? ['#FFE45C', '#FFC300'],
    name: me?.name ?? 'You',
    photoUrl: me?.photoUrl,
  };

  const faceStyle = (f: Face) => ({
    backgroundImage: `radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%), linear-gradient(150deg, ${f.gradient[0]}, ${f.gradient[1]})`,
  });

  /* Photo first, monogram otherwise — the emoji field is data, never an avatar. */
  const faceContent = (f: Face) => {
    if (f.photoUrl) {
      /* A plain public S3 object; next/image would need a remotePatterns entry
         per bucket, so a bare img is the honest call here. */
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={f.photoUrl}
          alt=""
          className="h-full w-full rounded-full object-cover"
          draggable={false}
        />
      );
    }
    const mono = initialsFor(f.name);
    return (
      <span className="y-cel-mono" style={{ fontSize: mono.length > 1 ? 24 : 30 }}>
        {mono}
      </span>
    );
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

          <div className="y-cel-face y-cel-face-a" aria-hidden style={faceStyle(myFace)}>
            {faceContent(myFace)}
          </div>
          <div className="y-cel-face y-cel-face-b" aria-hidden style={faceStyle(person)}>
            {faceContent(person)}
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
          This is the first step to a meaningful working relationship. The chat is
          open.
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
