'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAppState, type Notice } from '@/lib/store';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const DISMISS_MS = 6_000;
const EXIT_MS = 260;

const FALLBACK_GRADIENT: [string, string] = ['#FFD860', '#B8860B'];

function ToastStyles() {
  return (
    <style href="yellow-toast" precedence="high">{`
.y-toast-root{
  position:fixed; z-index:50; left:0; right:0;
  bottom:calc(96px + env(safe-area-inset-bottom, 0px));
  display:flex; justify-content:center; padding:0 12px;
  pointer-events:none;
}
/* The chat composer is sticky at the bottom of the same column; clear it. */
.y-toast-root[data-composer="true"]{
  bottom:calc(168px + env(safe-area-inset-bottom, 0px));
}
.y-toast-card{
  position:relative; pointer-events:auto; width:100%; max-width:420px;
  border-radius:20px; border:1px solid rgba(255,214,10,.16);
  background-image:
    radial-gradient(120% 100% at 24% 0%, rgba(255,195,0,.13) 0%, rgba(255,195,0,0) 64%),
    linear-gradient(180deg, rgba(28,24,14,.94) 0%, rgba(14,12,8,.95) 100%);
  backdrop-filter:blur(16px) saturate(1.1);
  -webkit-backdrop-filter:blur(16px) saturate(1.1);
  box-shadow:0 24px 60px -22px rgba(0,0,0,.92), inset 0 1px 0 rgba(255,214,10,.24);
  animation:y-toast-in-up 520ms cubic-bezier(.18,1.16,.32,1) both;
  will-change:transform;
}
.y-toast-card[data-leaving="true"]{
  animation:y-toast-out-down 260ms cubic-bezier(.5,0,.75,0) forwards;
}
@keyframes y-toast-in-up{
  from{ opacity:0; transform:translateY(20px) } to{ opacity:1; transform:none }
}
@keyframes y-toast-out-down{
  from{ opacity:1; transform:none } to{ opacity:0; transform:translateY(14px) }
}
@keyframes y-toast-in-right{
  from{ opacity:0; transform:translateX(28px) } to{ opacity:1; transform:none }
}
@keyframes y-toast-out-right{
  from{ opacity:1; transform:none } to{ opacity:0; transform:translateX(20px) }
}
.y-toast-link{
  display:flex; gap:12px; align-items:flex-start;
  padding:13px 42px 13px 13px; border-radius:20px; text-decoration:none;
  transition:background-color 200ms linear;
}
.y-toast-link:hover{ background-color:rgba(255,214,10,.05) }
.y-toast-link:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-toast-face{
  flex-shrink:0; width:42px; height:42px; border-radius:9999px;
  display:flex; align-items:center; justify-content:center; font-size:20px;
  box-shadow:0 0 18px -2px rgba(255,214,10,.32), inset 0 2px 0 rgba(255,255,255,.34);
}
.y-toast-eyebrow{
  display:flex; align-items:center; gap:6px; margin:1px 0 5px;
  font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:#FFD60A;
}
.y-toast-live{
  width:5px; height:5px; border-radius:9999px; flex-shrink:0;
  background:#FFD60A; box-shadow:0 0 8px rgba(255,214,10,.9);
  animation:y-toast-live 2.6s cubic-bezier(.45,0,.55,1) infinite;
}
@keyframes y-toast-live{
  0%,100%{ opacity:.35; transform:scale(.82) }
  50%    { opacity:1;   transform:scale(1) }
}
.y-toast-title{
  display:block; margin:0; font-size:14.5px; font-weight:600; line-height:1.35;
  letter-spacing:-.014em; color:#FFF8E7;
}
.y-toast-body{
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  margin:3px 0 0; font-size:12.5px; line-height:1.45; letter-spacing:-.004em;
  color:rgba(255,248,231,.52);
}
.y-toast-x{
  position:absolute; top:8px; right:8px; z-index:1;
  display:flex; align-items:center; justify-content:center;
  width:26px; height:26px; border:0; border-radius:9999px; cursor:pointer;
  background:transparent; font-size:12px; line-height:1;
  color:rgba(255,248,231,.4);
  transition:color 180ms linear, background-color 180ms linear;
}
.y-toast-x:hover{ color:#FFF8E7; background-color:rgba(255,248,231,.08) }
.y-toast-x:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
@media (min-width:768px){
  .y-toast-root,
  .y-toast-root[data-composer="true"]{
    left:auto; right:0; bottom:auto; top:0;
    justify-content:flex-end; padding:16px 18px 0;
  }
  .y-toast-card{ max-width:352px; animation-name:y-toast-in-right }
  .y-toast-card[data-leaving="true"]{ animation-name:y-toast-out-right }
}
@media (prefers-reduced-motion: reduce){
  .y-toast-live{ animation:none; opacity:.8 }
  .y-toast-card,
  .y-toast-card[data-leaving="true"]{ animation-duration:1ms }
}
`}</style>
  );
}

/** The person's own screen tells this story better; a toast on top is noise. */
function alreadyLooking(pathname: string, personId: string): boolean {
  return pathname === `/chat/${personId}` || pathname === `/connect/${personId}`;
}

function ToastCard({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const { people, pairs } = useAppState();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLeaving(true), DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onClose, EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, onClose]);

  const person = people.find((p) => p.id === notice.personId);
  // A real connection must never go unannounced because the directory poll lagged.
  const firstName = (person?.name ?? '').trim().split(/\s+/)[0] || 'Someone';
  const gradient = person?.gradient ?? FALLBACK_GRADIENT;
  const preview = pairs.find((p) => p.personId === notice.personId)?.lastMessagePreview;

  const connected = notice.kind === 'connected';
  const title = connected ? "You're connected!" : `${firstName} sent you a message`;
  const body = connected ? `You and ${firstName} both went first.` : (preview ?? '');

  return (
    <div className="y-toast-root" data-composer={pathname.startsWith('/chat/')}>
      <ToastStyles />

      <div className="y-toast-card" data-leaving={leaving} role="status" aria-live="polite">
        <Link href={`/chat/${notice.personId}`} className="y-toast-link" onClick={onClose}>
          <span
            aria-hidden="true"
            className="y-toast-face"
            style={{
              background: `radial-gradient(circle at 32% 28%, ${gradient[0]}, ${gradient[1]})`,
            }}
          >
            {person?.emoji ?? '\u{1F44B}'}
          </span>

          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="y-toast-eyebrow" style={{ fontFamily: MONO }}>
              <span aria-hidden="true" className="y-toast-live" />
              {connected ? 'New connection' : 'New message'}
            </span>
            <span className="y-toast-title" style={{ fontFamily: SANS }}>
              {title}
            </span>
            {body && (
              <span className="y-toast-body" style={{ fontFamily: SANS }}>
                {body}
              </span>
            )}
          </span>
        </Link>

        <button
          type="button"
          className="y-toast-x"
          onClick={() => setLeaving(true)}
          aria-label="Dismiss notification"
        >
          <span aria-hidden="true">&#10005;</span>
        </button>
      </div>
    </div>
  );
}

export default function Toast() {
  const { notice, dismissNotice } = useAppState();
  const pathname = usePathname();

  if (!notice || alreadyLooking(pathname, notice.personId)) return null;

  return (
    <ToastCard
      key={`${notice.personId}:${notice.at}`}
      notice={notice}
      onClose={dismissNotice}
    />
  );
}
