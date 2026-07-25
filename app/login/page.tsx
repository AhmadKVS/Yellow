'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/* Type stacks — pinned so the column never falls back to a system face. */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const STEP_SWAP_MS = 190;
/** If the config probe stalls, show the form anyway rather than a dead gate. */
const PROBE_CEILING_MS = 1500;

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

type Step = 'credentials' | 'confirm';

async function postJson(path: string, payload: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { res, data };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Where to land after signing in. The proxy appends `?next=` when it bounces
 * someone off a protected route, so honour it — but only same-origin absolute
 * paths, so a crafted `?next=//elsewhere.com` can't become an open redirect.
 */
function destination(): string {
  try {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  } catch {
    /* No search params to read — fall through to the root route. */
  }
  return '/';
}

/** Chrome glyph, per the design language: inline SVG, stroke 1.8, round caps. */
function EyeGlyph({ crossed }: { crossed: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M1.9 10S5 4.9 10 4.9 18.1 10 18.1 10 15 15.1 10 15.1 1.9 10 1.9 10Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.35" stroke="currentColor" strokeWidth="1.8" />
      {crossed ? (
        <path
          d="M3.7 3.7 16.3 16.3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — shared verbatim with app/signup/page.tsx so that  */
/* React's dedupe-by-href can only ever pick identical rules.           */
/* ------------------------------------------------------------------ */

function AuthStyles() {
  return (
    <style href="yellow-auth" precedence="high">{`
/* PhoneFrame owns the scroll container and the horizontal gutters
   (max-w-[560px] + px-5/md:px-8), so these screens add no side padding. */
.ya-root{display:flex;flex-direction:column;min-height:100dvh;position:relative}

/* --- rail: quiet mono instrumentation, no glow -------------------- */
.ya-rail{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:20px 0 14px;flex:none;
}
.ya-mark{display:flex;align-items:center;gap:8px}
.ya-dot{width:20px;height:20px;border-radius:999px;flex:none;box-shadow:0 0 10px 1px rgba(255,214,10,.35)}
.ya-wordmark{font-size:15px;font-weight:600;letter-spacing:-.02em;color:#FFF8E7}
.ya-steps{display:flex;align-items:center;gap:8px}
.ya-step{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(255,248,231,.26);transition:color 420ms cubic-bezier(.32,.72,0,1);
}
.ya-step[data-state="done"]{color:rgba(184,134,11,.9)}
.ya-step[data-state="now"]{color:#FFD60A}
.ya-tick{width:10px;height:1px;background:rgba(255,255,255,.14);flex:none}

/* --- body: these forms are short, so centre them instead of
       stranding them at the top of a tall column ------------------ */
.ya-body{
  flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;
  padding:8px 0 calc(40px + env(safe-area-inset-bottom,0px));
}
/* fill-mode 'backwards' so the entrance hands opacity/transform back
   and the exit transition can win. */
.ya-stage{
  animation:ya-rise 400ms cubic-bezier(.32,.72,0,1) backwards;
  transition:opacity ${STEP_SWAP_MS}ms ease, transform ${STEP_SWAP_MS}ms ease;
}
.ya-stage[data-phase="out"]{opacity:0;transform:translateY(-14px)}

/* --- type ladder -------------------------------------------------- */
.ya-eyebrow{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:#B8860B;margin:0 0 12px;
}
.ya-h1{
  font-size:clamp(26px,7.2vw,30px);font-weight:700;letter-spacing:-.03em;
  line-height:1.1;color:#FFF8E7;margin:0;text-wrap:balance;
}
.ya-h1 em{font-style:normal;color:#FFD60A}
.ya-sub{
  font-size:15px;line-height:1.5;color:rgba(255,248,231,.62);
  margin:12px 0 0;max-width:36ch;text-wrap:pretty;
}
.ya-sub b{font-weight:500;color:#FFF8E7}

/* --- fields: iOS inset cards, hairline stroke, yellow on focus ----- */
.ya-form{margin-top:26px;display:flex;flex-direction:column;gap:10px}
.ya-field{
  position:relative;border-radius:14px;background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),inset 0 1px 0 rgba(255,255,255,.05);
  transition:background 260ms cubic-bezier(.32,.72,0,1),
             box-shadow 260ms cubic-bezier(.32,.72,0,1);
}
.ya-field:focus-within{
  background:rgba(255,214,10,.07);
  box-shadow:inset 0 0 0 1px rgba(255,214,10,.42),inset 0 1px 0 rgba(255,255,255,.05);
}
.ya-label{
  display:block;padding:11px 14px 0;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.9);transition:color 260ms ease;
}
.ya-field:focus-within .ya-label{color:rgba(255,214,10,.85)}
.ya-inputrow{display:flex;align-items:flex-end;gap:4px;padding:0 10px 0 14px}
/* 16px keeps iOS from zooming the viewport on focus. */
.ya-input{
  flex:1;min-width:0;border:0;background:transparent;padding:4px 0 12px;
  color:#FFF8E7;font-size:16px;line-height:1.4;letter-spacing:-.015em;
}
.ya-input:focus{outline:none}
.ya-input::placeholder{color:rgba(255,248,231,.26)}
.ya-input:disabled{color:rgba(255,248,231,.40);cursor:default}
/* ::after grows the hit area to 44px without moving the glyph. */
.ya-peek{
  position:relative;flex:none;display:flex;align-items:center;justify-content:center;
  width:34px;height:34px;margin-bottom:5px;padding:0;
  border:0;border-radius:999px;background:transparent;cursor:pointer;
  color:rgba(255,248,231,.55);transition:color 180ms ease;
  -webkit-tap-highlight-color:transparent;
}
.ya-peek::after{content:'';position:absolute;inset:-5px}
.ya-peek:hover:not(:disabled),.ya-peek[aria-pressed="true"]:not(:disabled){color:#FFD60A}
.ya-peek:disabled{color:rgba(255,248,231,.26);cursor:default}
.ya-peek:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

/* --- password requirements: cold = quiet outline, met = tinted ---- */
.ya-rules{
  display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0;list-style:none;
}
.ya-rule{
  display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px 0 9px;
  border-radius:999px;background:transparent;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);
  font-size:10.5px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;
  color:rgba(255,248,231,.40);
  transition:color 320ms cubic-bezier(.32,.72,0,1),
             background 320ms cubic-bezier(.32,.72,0,1),
             box-shadow 320ms cubic-bezier(.32,.72,0,1);
}
.ya-rule-mark{
  width:5px;height:5px;border-radius:999px;background:rgba(255,248,231,.26);flex:none;
  transition:background 320ms ease,transform 320ms cubic-bezier(.32,.72,0,1);
}
/* Met = yellow glass: tint over a white base, blurred, with a top light. */
.ya-rule[data-met="true"]{
  color:#FFD60A;
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  animation:ya-lit 380ms cubic-bezier(.32,.72,0,1);
}
.ya-rule[data-met="true"] .ya-rule-mark{background:#FFD60A;transform:scale(1.35)}

/* --- confirmation code ------------------------------------------ */
.ya-codefield{
  margin-top:4px;padding:20px 14px 16px;border-radius:18px;
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),
             inset 0 1px 0 rgba(255,255,255,.05),
             0 10px 30px -12px rgba(0,0,0,.6);
  transition:background 240ms cubic-bezier(.32,.72,0,1),
             box-shadow 240ms cubic-bezier(.32,.72,0,1);
}
.ya-codefield:focus-within{
  background:rgba(255,214,10,.07);
  box-shadow:inset 0 0 0 1px rgba(255,214,10,.42),
             inset 0 1px 0 rgba(255,255,255,.05),
             0 10px 30px -12px rgba(0,0,0,.6);
}
/* text-indent cancels the trailing letter-space so the digits stay
   optically centred rather than drifting left. */
.ya-code{
  display:block;width:100%;border:0;background:transparent;text-align:center;
  color:#FFF8E7;font-size:clamp(28px,7.6vw,33px);font-weight:600;
  letter-spacing:.34em;text-indent:.34em;font-variant-numeric:tabular-nums;
}
.ya-code:focus{outline:none}
.ya-code::placeholder{color:rgba(255,248,231,.16)}
.ya-ticks{display:flex;justify-content:center;gap:9px;margin-top:18px}
.ya-ticks span{
  width:28px;height:4px;border-radius:999px;background:rgba(255,248,231,.13);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);
  transition:background 240ms cubic-bezier(.32,.72,0,1),
             box-shadow 240ms cubic-bezier(.32,.72,0,1);
}
/* Lit = the same yellow glass, weighted up so a 4px bar still reads lit. */
.ya-ticks span[data-on="true"]{
  background:linear-gradient(180deg,rgba(255,214,10,.62),rgba(255,214,10,.44)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.28);
}

/* --- messages: glass banners, warm not alarming -------------------- */
.ya-error,.ya-notice{
  margin:2px 0 0;padding:12px 14px;border-radius:14px;
  font-size:13.5px;line-height:1.45;
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  animation:ya-rise 260ms cubic-bezier(.32,.72,0,1) backwards;
}
.ya-error{
  background:linear-gradient(180deg,rgba(255,138,0,.18),rgba(255,138,0,.12)),rgba(255,255,255,.05);
  color:#FFD3AC;
}
.ya-notice{
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  color:rgba(255,248,231,.78);
}

/* --- CTA: the one filled pill, and the one glow, per screen ------- */
.ya-cta{
  display:flex;align-items:center;justify-content:center;gap:9px;
  width:100%;height:50px;margin-top:10px;border:0;border-radius:999px;cursor:pointer;
  background:linear-gradient(180deg,#FFE45C,#FFC300);color:#1A1200;text-decoration:none;
  font-size:15px;font-weight:600;letter-spacing:-.01em;
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55),inset 0 1px 0 rgba(255,255,255,.45);
  transition:transform 120ms cubic-bezier(.32,.72,0,1),box-shadow 200ms ease,
             background 200ms ease;
  -webkit-tap-highlight-color:transparent;
}
.ya-cta:hover:not(:disabled){
  box-shadow:0 12px 30px -10px rgba(255,199,0,.72),inset 0 1px 0 rgba(255,255,255,.45);
}
.ya-cta:active:not(:disabled){transform:scale(.97)}
.ya-cta:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.ya-cta:disabled{
  background:rgba(255,255,255,.055);color:rgba(255,248,231,.26);
  box-shadow:none;cursor:default;
}

/* --- plain / tinted buttons and links ---------------------------- */
.ya-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
.ya-footnote{margin:16px 0 0;text-align:center;font-size:12.5px;color:rgba(255,248,231,.40)}
.ya-link{
  display:inline-block;padding:11px 6px;margin:-11px -2px;
  color:#FFD60A;font-weight:500;text-decoration:none;
  transition:color 180ms ease;-webkit-tap-highlight-color:transparent;
}
.ya-link:hover{color:#FFE45C}
.ya-link:focus-visible{outline:2px solid #FFD60A;outline-offset:2px;border-radius:8px}
button.ya-link{border:0;background:transparent;font:inherit;cursor:pointer}
.ya-plain{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;padding:0 4px;border:0;background:transparent;cursor:pointer;
  font-size:13.5px;font-weight:500;letter-spacing:-.01em;color:rgba(255,248,231,.62);
  transition:color 180ms ease;-webkit-tap-highlight-color:transparent;
}
.ya-plain:hover:not(:disabled){color:#FFD60A}
.ya-plain:disabled{color:rgba(255,248,231,.26);cursor:default}
.ya-plain:focus-visible{outline:2px solid #FFD60A;outline-offset:2px;border-radius:10px}
/* Secondary action = yellow glass, never a second filled pill. */
.ya-tinted{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;padding:0 18px;border:0;border-radius:999px;cursor:pointer;
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  color:#FFD60A;font-size:13.5px;font-weight:600;letter-spacing:-.01em;
  transition:background 180ms ease,box-shadow 180ms ease,
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.ya-tinted:hover:not(:disabled){
  background:linear-gradient(180deg,rgba(255,214,10,.24),rgba(255,214,10,.18)),rgba(255,255,255,.07);
}
.ya-tinted:active:not(:disabled){transform:scale(.97)}
.ya-tinted:disabled{
  background:rgba(255,255,255,.045);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
  -webkit-backdrop-filter:none;backdrop-filter:none;
  color:rgba(255,248,231,.26);cursor:default;
}
.ya-tinted:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

/* --- standing notes (auth off / already signed in) --------------- */
.ya-note{
  margin-top:22px;padding:18px;border-radius:18px;
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),
             inset 0 1px 0 rgba(255,255,255,.05),
             0 10px 30px -12px rgba(0,0,0,.6);
}
.ya-note-title{
  margin:0;font-size:10.5px;font-weight:500;letter-spacing:.14em;
  text-transform:uppercase;color:#B8860B;
}
.ya-note-body{margin:10px 0 0;font-size:15px;line-height:1.5;color:rgba(255,248,231,.62)}

/* --- gate -------------------------------------------------------- */
.ya-gate{
  flex:1;display:flex;align-items:center;justify-content:center;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.8);animation:ya-breathe 1.6s ease-in-out infinite;
}

/* --- keyframes ---------------------------------------------------- */
@keyframes ya-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes ya-lit{0%{transform:scale(.94)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes ya-breathe{0%,100%{opacity:.4}50%{opacity:.95}}

/* No backdrop-filter (older Firefox): raise the fill so nothing turns
   into see-through soup. */
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .ya-rule[data-met="true"],.ya-tinted,.ya-notice{background:rgba(60,48,10,.85)}
  .ya-tinted:hover:not(:disabled){background:rgba(76,61,14,.9)}
  .ya-error{background:rgba(68,36,6,.88)}
  .ya-ticks span[data-on="true"]{background:rgba(255,214,10,.8)}
}

@media (prefers-reduced-motion: reduce){
  .ya-stage,.ya-error,.ya-notice{animation-duration:1ms}
  .ya-rule[data-met="true"]{animation:none}
  .ya-rule[data-met="true"] .ya-rule-mark{transform:none}
  .ya-ticks span{transition-duration:1ms}
  .ya-cta:active:not(:disabled),.ya-tinted:active:not(:disabled){transform:none}
  .ya-gate{animation:none}
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */

export default function LoginPage() {
  const [step, setStep] = useState<Step>('credentials');
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  /* Probe: is auth even switched on, and are we already signed in?
     `enforced` is read at runtime rather than from the NEXT_PUBLIC_ flag at
     build time — a stale inlined constant can dead-code-eliminate the escape
     hatch below, and this screen must never become a dead end. */
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [enforced, setEnforced] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  const alive = useRef(true);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const swapTimer = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ceiling = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, PROBE_CEILING_MS);

    const probe = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        setConfigured(data.configured === true);
        setEnforced(data.enforced === true);
        const user = data.user as { name?: string; email?: string } | null;
        setSignedInAs(user ? user.name || user.email || 'your account' : null);
      } catch {
        /* Probe failed — treat auth as off. Failing towards "come in"
           is always the right direction here. */
        if (!cancelled) {
          setConfigured(false);
          setEnforced(false);
        }
      } finally {
        if (!cancelled) setReady(true);
        window.clearTimeout(ceiling);
      }
    };

    void probe();
    return () => {
      cancelled = true;
      window.clearTimeout(ceiling);
    };
  }, []);

  const goTo = useCallback((next: Step) => {
    setPhase('out');
    swapTimer.current = window.setTimeout(() => {
      if (!alive.current) return;
      setStep(next);
      setPhase('in');
    }, STEP_SWAP_MS);
  }, []);

  useEffect(() => {
    if (step === 'confirm' && phase === 'in') codeRef.current?.focus();
  }, [step, phase]);

  /* ---------------- sign in ---------------- */

  const handleSignIn = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting || redirecting) return;
      setError('');
      setNotice('');
      setSubmitting(true);

      try {
        const { res, data } = await postJson('/api/auth/login', {
          email,
          password,
        });
        if (!alive.current) return;

        if (res.status === 503 && data.reason === 'not_configured') {
          setConfigured(false);
          return;
        }
        if (data.needsConfirmation === true) {
          setNotice(
            text(data.error) ||
              'Confirm your email to finish signing in. We just sent a fresh code.',
          );
          setCode('');
          goTo('confirm');
          return;
        }
        if (!res.ok || data.ok !== true) {
          setError(text(data.error) || 'Something went wrong. Try again.');
          emailRef.current?.focus();
          return;
        }

        setRedirecting(true);
        /* A full reload, not `router.push`: the app state provider lives in
           the root layout and only resolves identity once per page load. A
           client-side navigation would carry over whatever this tab already
           had cached — a different account's profile, on a device that was
           last signed in as someone else. */
        window.location.assign(destination());
      } catch {
        if (alive.current) {
          setError("Couldn't reach the sign-in service. Try again in a moment.");
        }
      } finally {
        if (alive.current) setSubmitting(false);
      }
    },
    [email, goTo, password, redirecting, submitting],
  );

  /* ---------------- confirm then sign in ---------------- */

  const handleConfirm = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting || redirecting) return;
      setError('');
      setNotice('');
      setSubmitting(true);

      try {
        const confirmed = await postJson('/api/auth/confirm', { email, code });
        if (!alive.current) return;

        if (
          confirmed.res.status === 503 &&
          confirmed.data.reason === 'not_configured'
        ) {
          setConfigured(false);
          return;
        }
        if (!confirmed.res.ok || confirmed.data.ok !== true) {
          setError(
            text(confirmed.data.error) || "That code didn't work. Try again.",
          );
          codeRef.current?.focus();
          return;
        }

        const signedIn = await postJson('/api/auth/login', { email, password });
        if (!alive.current) return;

        if (signedIn.res.ok && signedIn.data.ok === true) {
          setRedirecting(true);
          window.location.assign(destination());
          return;
        }

        setNotice('Email confirmed. Sign in to pick up where you left off.');
        setPassword('');
        goTo('credentials');
      } catch {
        if (alive.current) {
          setError("Couldn't reach the sign-in service. Try again in a moment.");
        }
      } finally {
        if (alive.current) setSubmitting(false);
      }
    },
    [code, email, goTo, password, redirecting, submitting],
  );

  const handleResend = useCallback(async () => {
    if (resending || submitting) return;
    setError('');
    setNotice('');
    setResending(true);
    try {
      const { res, data } = await postJson('/api/auth/confirm', {
        email,
        action: 'resend',
      });
      if (!alive.current) return;
      if (res.ok && data.ok === true) {
        setNotice('New code sent. It can take a moment to land.');
      } else {
        setError(text(data.error) || "Couldn't send a new code just yet.");
      }
    } catch {
      if (alive.current) setError("Couldn't reach the sign-in service.");
    } finally {
      if (alive.current) setResending(false);
    }
  }, [email, resending, submitting]);

  const handleSignOut = useCallback(async () => {
    try {
      await postJson('/api/auth/logout', {});
    } catch {
      /* Cookies may already be gone; nothing to recover. */
    }
    if (alive.current) setSignedInAs(null);
  }, []);

  /* ---------------- render ---------------- */

  if (!ready) {
    return (
      <div className="ya-root" style={{ fontFamily: SANS }}>
        <AuthStyles />
        <p className="ya-gate" style={{ fontFamily: MONO }}>
          Yellow
        </p>
      </div>
    );
  }

  const canSignIn = email.trim().length > 0 && password.length > 0;
  const ctaLabel = redirecting
    ? 'Opening Yellow…'
    : submitting
      ? 'Signing you in…'
      : 'Sign in';

  return (
    <div className="ya-root" style={{ fontFamily: SANS }}>
      <AuthStyles />

      <header className="ya-rail">
        <div className="ya-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/yellow-sun-mark-128.png" alt="" aria-hidden="true" className="ya-dot" />
          <span className="ya-wordmark">Yellow</span>
        </div>
        {configured ? (
          <span className="ya-step" data-state="now" style={{ fontFamily: MONO }}>
            {step === 'confirm' ? 'Confirm' : 'Sign in'}
          </span>
        ) : null}
      </header>

      <div className="ya-body">
        <div className="ya-stage" data-phase={phase} key={step}>
          {/* ------- auth switched off: a door, not a wall ------- */}
          {!configured ? (
            <>
              <p className="ya-eyebrow" style={{ fontFamily: MONO }}>
                Come on in
              </p>
              <h1 className="ya-h1">
                No account needed <em>yet</em>.
              </h1>
              <div className="ya-note">
                <p className="ya-note-title" style={{ fontFamily: MONO }}>
                  Accounts aren&rsquo;t switched on
                </p>
                <p className="ya-note-body">
                  Yellow runs without one. Head straight in and start with your
                  profile — sign-in turns on later without changing a thing.
                </p>
              </div>
              <Link href="/" className="ya-cta" style={{ marginTop: 18 }}>
                Continue to Yellow
              </Link>
            </>
          ) : signedInAs ? (
            <>
              <p className="ya-eyebrow" style={{ fontFamily: MONO }}>
                Already in
              </p>
              <h1 className="ya-h1">
                You&rsquo;re signed in as <em>{signedInAs}</em>.
              </h1>
              <Link href="/" className="ya-cta" style={{ marginTop: 24 }}>
                Continue to Yellow
              </Link>
              <p className="ya-footnote">
                Not you?{' '}
                <button type="button" className="ya-link" onClick={handleSignOut}>
                  Sign out
                </button>
              </p>
            </>
          ) : step === 'credentials' ? (
            <>
              <p className="ya-eyebrow" style={{ fontFamily: MONO }}>
                Welcome back
              </p>
              <h1 className="ya-h1">
                Pick up where you <em>left off</em>.
              </h1>
              <p className="ya-sub">
                Your matches, hubs, and half-finished conversations are all
                still there.
              </p>

              <form className="ya-form" onSubmit={handleSignIn} noValidate>
                <div className="ya-field">
                  <label className="ya-label" htmlFor="ya-email" style={{ fontFamily: MONO }}>
                    Email
                  </label>
                  <div className="ya-inputrow">
                    <input
                      id="ya-email"
                      ref={emailRef}
                      className="ya-input"
                      type="email"
                      value={email}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      disabled={submitting || redirecting}
                      placeholder="you@wherever.com"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="ya-field">
                  <label className="ya-label" htmlFor="ya-password" style={{ fontFamily: MONO }}>
                    Password
                  </label>
                  <div className="ya-inputrow">
                    <input
                      id="ya-password"
                      className="ya-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      autoComplete="current-password"
                      disabled={submitting || redirecting}
                      placeholder="••••••••"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="ya-peek"
                      disabled={submitting || redirecting}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <EyeGlyph crossed={showPassword} />
                      <span style={srOnly}>
                        {showPassword ? 'Hide password' : 'Show password'}
                      </span>
                    </button>
                  </div>
                </div>

                {notice ? (
                  <p className="ya-notice" role="status">
                    {notice}
                  </p>
                ) : null}
                {error ? (
                  <p className="ya-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="ya-cta"
                  disabled={!canSignIn || submitting || redirecting}
                >
                  {ctaLabel}
                </button>
              </form>

              <p className="ya-footnote">
                First time here?{' '}
                <Link href="/signup" className="ya-link">
                  Create an account
                </Link>
              </p>

              {!enforced ? (
                <p className="ya-footnote" style={{ marginTop: 6 }}>
                  <Link href="/" className="ya-link">
                    Skip for now
                  </Link>{' '}
                  — you don&rsquo;t need an account yet.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="ya-eyebrow" style={{ fontFamily: MONO }}>
                One more step
              </p>
              <h1 className="ya-h1">
                Let&rsquo;s confirm <em>your email</em>.
              </h1>
              <p className="ya-sub">
                We sent a six-digit code to <b>{email}</b>. Enter it and
                you&rsquo;re in.
              </p>

              <form className="ya-form" onSubmit={handleConfirm} noValidate>
                <div className="ya-codefield">
                  <label htmlFor="ya-code" style={srOnly}>
                    Six-digit confirmation code
                  </label>
                  <input
                    id="ya-code"
                    ref={codeRef}
                    className="ya-code"
                    style={{ fontFamily: MONO }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    disabled={submitting || redirecting}
                    placeholder="000000"
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                  />
                  <div className="ya-ticks" aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <span key={i} data-on={code.length > i} />
                    ))}
                  </div>
                </div>

                {notice ? (
                  <p className="ya-notice" role="status">
                    {notice}
                  </p>
                ) : null}
                {error ? (
                  <p className="ya-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="ya-cta"
                  disabled={code.length !== 6 || submitting || redirecting}
                >
                  {redirecting
                    ? 'Opening Yellow…'
                    : submitting
                      ? 'Confirming…'
                      : 'Confirm and sign in'}
                </button>
              </form>

              <div className="ya-row">
                <button
                  type="button"
                  className="ya-plain"
                  disabled={submitting || redirecting}
                  onClick={() => {
                    setError('');
                    setNotice('');
                    goTo('credentials');
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="ya-tinted"
                  disabled={resending || submitting || redirecting}
                  onClick={handleResend}
                >
                  {resending ? 'Sending…' : 'Send a new code'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
