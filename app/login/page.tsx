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
import { useRouter } from 'next/navigation';

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

/* --- rail ------------------------------------------------------- */
.ya-rail{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:18px 0 16px;flex:none;
}
.ya-mark{display:flex;align-items:center;gap:7px}
.ya-dot{
  width:9px;height:9px;border-radius:999px;background:#FFD60A;
  box-shadow:0 0 12px rgba(255,214,10,.85);
}
.ya-wordmark{font-size:13.5px;font-weight:600;letter-spacing:-.02em;color:#FFF8E7}
.ya-steps{display:flex;align-items:center;gap:7px}
.ya-step{
  font-size:9px;letter-spacing:.2em;text-transform:uppercase;
  color:rgba(184,134,11,.45);transition:color 420ms ease;
}
.ya-step[data-state="done"]{color:rgba(184,134,11,.95)}
.ya-step[data-state="now"]{color:#FFD60A;text-shadow:0 0 14px rgba(255,214,10,.5)}
.ya-tick{width:9px;height:1px;background:rgba(184,134,11,.35)}

/* --- body: these forms are short, so centre them instead of
       stranding them at the top of a tall column ------------------ */
.ya-body{
  flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;
  padding:8px 0 calc(40px + env(safe-area-inset-bottom,0px));
}
/* fill-mode 'backwards' so the entrance hands opacity/transform back
   and the exit transition can win. */
.ya-stage{
  animation:ya-rise 400ms cubic-bezier(.22,1,.36,1) backwards;
  transition:opacity ${STEP_SWAP_MS}ms ease, transform ${STEP_SWAP_MS}ms ease;
}
.ya-stage[data-phase="out"]{opacity:0;transform:translateY(-14px)}

/* --- type ------------------------------------------------------- */
.ya-eyebrow{
  font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#B8860B;
  margin:0 0 14px;
}
.ya-h1{
  font-size:clamp(28px,7.6vw,38px);font-weight:600;letter-spacing:-.04em;
  line-height:1.05;color:#FFF8E7;margin:0;text-wrap:balance;
}
.ya-h1 em{font-style:normal;color:#FFD60A}
.ya-sub{
  font-size:14.5px;line-height:1.55;color:rgba(255,248,231,.55);
  margin:14px 0 0;max-width:34ch;text-wrap:pretty;
}
.ya-sub b{font-weight:500;color:rgba(255,248,231,.82)}

/* --- fields ----------------------------------------------------- */
.ya-form{margin-top:26px;display:flex;flex-direction:column;gap:10px}
.ya-field{
  position:relative;padding-left:14px;border-radius:4px 16px 16px 4px;
  background:rgba(255,248,231,.035);transition:background 260ms ease;
}
.ya-field::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:2px;border-radius:999px;
  background:rgba(184,134,11,.42);
  transition:background 260ms ease,box-shadow 260ms ease;
}
.ya-field:focus-within{background:rgba(255,214,10,.05)}
.ya-field:focus-within::before{background:#FFD60A;box-shadow:0 0 16px rgba(255,214,10,.75)}
.ya-label{
  display:block;padding:11px 14px 0 4px;
  font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(184,134,11,.95);
}
.ya-inputrow{display:flex;align-items:flex-end;gap:10px;padding-right:13px}
/* 16px keeps iOS from zooming the viewport on focus. */
.ya-input{
  flex:1;min-width:0;border:0;background:transparent;padding:3px 0 12px 4px;
  color:#FFF8E7;font-size:16px;line-height:1.45;letter-spacing:-.015em;
}
.ya-input:focus{outline:none}
.ya-input::placeholder{color:rgba(255,248,231,.26)}
.ya-input:disabled{color:rgba(255,248,231,.42);cursor:default}
.ya-peek{
  flex:none;border:0;background:transparent;cursor:pointer;padding:2px 0 13px;
  font-size:9px;letter-spacing:.16em;text-transform:uppercase;
  color:rgba(184,134,11,.95);transition:color 180ms ease;
}
.ya-peek:hover:not(:disabled){color:#FFD60A}
.ya-peek:disabled{color:rgba(184,134,11,.4);cursor:default}
.ya-peek:focus-visible{outline:2px solid #FFD60A;outline-offset:2px;border-radius:4px}

/* --- password requirements: the filaments warm up one by one
       instead of grading you pass/fail -------------------------- */
.ya-rules{
  display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0;padding:0;list-style:none;
}
.ya-rule{
  display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 9px;
  border-radius:999px;border:1px solid rgba(184,134,11,.28);
  font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
  color:rgba(184,134,11,.9);
  transition:color 300ms ease,border-color 300ms ease,background 300ms ease,box-shadow 300ms ease;
}
.ya-rule-mark{
  width:5px;height:5px;border-radius:999px;background:rgba(184,134,11,.5);flex:none;
  transition:background 300ms ease,transform 300ms cubic-bezier(.22,1,.36,1);
}
.ya-rule[data-met="true"]{
  color:#0B0A08;background:#FFD60A;border-color:#FFD60A;
  box-shadow:0 0 18px rgba(255,214,10,.32);
  animation:ya-lit 420ms cubic-bezier(.22,1,.36,1);
}
.ya-rule[data-met="true"] .ya-rule-mark{background:#0B0A08;transform:scale(1.4)}

/* --- confirmation code ------------------------------------------ */
.ya-codefield{
  margin-top:6px;padding:18px 12px 15px;border-radius:18px;
  border:1px solid rgba(184,134,11,.3);background:rgba(255,248,231,.035);
  transition:border-color 240ms ease,background 240ms ease;
}
.ya-codefield:focus-within{border-color:rgba(255,214,10,.75);background:rgba(255,214,10,.05)}
/* text-indent cancels the trailing letter-space so the digits stay
   optically centred rather than drifting left. */
.ya-code{
  display:block;width:100%;border:0;background:transparent;text-align:center;
  color:#FFF8E7;font-size:clamp(26px,7.4vw,31px);font-weight:600;
  letter-spacing:.34em;text-indent:.34em;font-variant-numeric:tabular-nums;
}
.ya-code:focus{outline:none}
.ya-code::placeholder{color:rgba(255,248,231,.15)}
.ya-ticks{display:flex;justify-content:center;gap:10px;margin-top:16px}
.ya-ticks span{
  width:26px;height:2px;border-radius:999px;background:rgba(184,134,11,.3);
  transition:background 240ms ease,box-shadow 240ms ease;
}
.ya-ticks span[data-on="true"]{background:#FFD60A;box-shadow:0 0 12px rgba(255,214,10,.7)}

/* --- messages --------------------------------------------------- */
.ya-error,.ya-notice{
  margin:2px 0 0;padding:11px 14px;border-radius:4px 14px 14px 4px;
  font-size:13px;line-height:1.5;animation:ya-rise 260ms ease backwards;
}
/* Warm orange, not red — a wrong password is a stumble, not an alarm. */
.ya-error{background:rgba(255,138,0,.1);border-left:2px solid #FF8A00;color:#FFCC9B}
.ya-notice{background:rgba(255,214,10,.07);border-left:2px solid rgba(255,214,10,.65);color:rgba(255,248,231,.72)}

/* --- CTA -------------------------------------------------------- */
.ya-cta{
  display:flex;align-items:center;justify-content:center;gap:9px;
  width:100%;height:52px;margin-top:8px;border:0;border-radius:999px;cursor:pointer;
  background:linear-gradient(180deg,#FFDE3B,#FFC300);color:#0B0A08;text-decoration:none;
  font-size:15.5px;font-weight:650;letter-spacing:-.015em;
  box-shadow:0 6px 26px rgba(255,195,0,.3),inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform 200ms cubic-bezier(.22,1,.36,1),box-shadow 200ms ease,opacity 200ms ease;
  -webkit-tap-highlight-color:transparent;
}
.ya-cta:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 34px rgba(255,195,0,.44),inset 0 1px 0 rgba(255,255,255,.5)}
.ya-cta:active:not(:disabled){transform:scale(.978)}
.ya-cta:focus-visible{outline:2px solid #FFD60A;outline-offset:3px}
.ya-cta:disabled{background:rgba(255,248,231,.07);color:rgba(255,248,231,.3);box-shadow:none;cursor:default}

/* --- links and footers ------------------------------------------- */
.ya-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:18px}
.ya-footnote{margin:14px 0 0;text-align:center;font-size:12.5px;color:rgba(255,248,231,.4)}
.ya-link{
  color:#FFD60A;text-decoration:none;
  border-bottom:1px solid rgba(255,214,10,.35);padding-bottom:1px;
  transition:border-color 180ms ease;
}
.ya-link:hover{border-color:#FFD60A}
.ya-link:focus-visible{outline:2px solid #FFD60A;outline-offset:3px;border-radius:2px}
/* Same affordance when the link is really a button (sign out). */
button.ya-link{
  border:0;border-bottom:1px solid rgba(255,214,10,.35);
  background:transparent;padding:0 0 1px;font:inherit;cursor:pointer;
}
.ya-ghostbtn{
  border:0;background:transparent;cursor:pointer;padding:2px 0;
  font-size:9px;letter-spacing:.18em;text-transform:uppercase;
  color:rgba(184,134,11,.95);transition:color 180ms ease;
}
.ya-ghostbtn:hover:not(:disabled){color:#FFD60A}
.ya-ghostbtn:disabled{color:rgba(184,134,11,.4);cursor:default}
.ya-ghostbtn:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

/* --- standing notes (auth off / already signed in) --------------- */
.ya-note{
  margin-top:26px;padding:16px 18px;border-radius:4px 18px 18px 4px;
  border-left:2px solid rgba(184,134,11,.75);background:rgba(255,248,231,.035);
}
.ya-note-title{
  margin:0;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:#B8860B;
}
.ya-note-body{margin:9px 0 0;font-size:14px;line-height:1.55;color:rgba(255,248,231,.62)}

/* --- gate -------------------------------------------------------- */
.ya-gate{
  flex:1;display:flex;align-items:center;justify-content:center;
  font-size:10px;letter-spacing:.24em;text-transform:uppercase;
  color:rgba(184,134,11,.7);animation:ya-breathe 1.5s ease-in-out infinite;
}

/* --- keyframes ---------------------------------------------------- */
@keyframes ya-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes ya-lit{0%{transform:scale(.92)}60%{transform:scale(1.05)}100%{transform:scale(1)}}
@keyframes ya-breathe{0%,100%{opacity:.4}50%{opacity:.95}}

@media (prefers-reduced-motion: reduce){
  .ya-stage,.ya-error,.ya-notice{animation-duration:1ms}
  .ya-rule[data-met="true"]{animation:none}
  .ya-rule[data-met="true"] .ya-rule-mark{transform:none}
  .ya-cta:hover:not(:disabled),.ya-cta:active:not(:disabled){transform:none}
  .ya-gate{animation:none}
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */

export default function LoginPage() {
  const router = useRouter();

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
        router.push(destination());
      } catch {
        if (alive.current) {
          setError("Couldn't reach the sign-in service. Try again in a moment.");
        }
      } finally {
        if (alive.current) setSubmitting(false);
      }
    },
    [email, goTo, password, redirecting, router, submitting],
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
          router.push(destination());
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
    [code, email, goTo, password, redirecting, router, submitting],
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
          <span className="ya-dot" aria-hidden="true" />
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
              <Link href="/" className="ya-cta" style={{ marginTop: 22 }}>
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
              <Link href="/" className="ya-cta" style={{ marginTop: 26 }}>
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
                      style={{ fontFamily: MONO }}
                      disabled={submitting || redirecting}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? 'Hide' : 'Show'}
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
                <p className="ya-footnote" style={{ marginTop: 8 }}>
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
                  className="ya-ghostbtn"
                  style={{ fontFamily: MONO }}
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
                  className="ya-ghostbtn"
                  style={{ fontFamily: MONO }}
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
