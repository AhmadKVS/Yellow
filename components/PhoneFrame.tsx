'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TabBar } from './TabBar';
import Toast from './Toast';

interface SessionUser {
  name?: string;
  email?: string;
}

function FrameStyles() {
  return (
    <style href="yellow-frame" precedence="high">{`
.y-frame-bg{ position:fixed; inset:0; z-index:-10; overflow:hidden; background:#050403 }
/* Light from above, once. The pool sits under the sidebar's leading edge so the
   chrome glass has warmth to refract; the vignette then lets the corners fall
   to true black, so depth comes from the black and not from bloom. */
.y-frame-dome{
  position:absolute; left:50%; top:-56vh; width:124vh; height:124vh;
  margin-left:-62vh; border-radius:9999px;
  background:radial-gradient(circle,
    rgba(255,201,10,.075) 0%,
    rgba(255,190,20,.024) 40%,
    rgba(255,190,20,0) 62%);
}
.y-frame-pool{
  position:absolute; left:-190px; top:22%; width:640px; height:640px;
  border-radius:9999px;
  background:radial-gradient(circle,
    rgba(255,186,20,.05) 0%,
    rgba(255,170,30,.016) 46%,
    rgba(255,170,30,0) 72%);
}
/* No sidebar to refract below md — the pool would only muddy the canvas. */
@media (max-width:767px){ .y-frame-pool{ display:none } }
.y-frame-vignette{
  position:absolute; inset:-8%;
  background:radial-gradient(circle at 50% 14%,
    rgba(5,4,3,0) 20%, rgba(5,4,3,.62) 62%, rgba(5,4,3,.96) 100%);
}

/* Chrome glass — sidebar, bars, toasts. Fallback lives in globals.css. */
.y-glass{
  background:var(--glass-chrome);
  -webkit-backdrop-filter:var(--glass-chrome-filter);
  backdrop-filter:var(--glass-chrome-filter);
}

.y-side-edge{ box-shadow:inset -1px 0 0 var(--glass-hairline) }
.y-top-hairline{ box-shadow:inset 0 1px 0 rgba(255,255,255,.08) }

.y-brand-mark{
  width:22px; height:22px; flex-shrink:0; border-radius:9999px;
  box-shadow:0 0 12px 1px rgba(255,214,10,.35);
}

/* Sign-out sits on the same 24px optical margin as the nav pills, and picks up
   the same pill hover so the sidebar reads as one column of rows. */
.y-signout{
  display:block; width:100%; margin-top:7px; padding:8px 10px;
  border:0; border-radius:9999px; background:transparent; cursor:pointer;
  text-align:left; font:inherit; font-size:12.5px; letter-spacing:-.005em;
  color:rgba(255,248,231,.46);
  transition:color 220ms var(--ease-ios), background-color 220ms var(--ease-ios);
}
.y-signout:hover{ color:#FFD60A; background:rgba(255,255,255,.045) }
.y-signout:disabled{ opacity:.5; cursor:default }

.y-signout-strip{
  flex-shrink:0; border:0; background:transparent; cursor:pointer;
  padding:4px 2px; font:inherit; font-size:11.5px; letter-spacing:-.004em;
  color:rgba(255,248,231,.5);
  transition:color 200ms var(--ease-ios);
}
.y-signout-strip:active{ color:#FFD60A }
.y-signout-strip:disabled{ opacity:.5 }

@media (prefers-reduced-motion: reduce){
  .y-signout, .y-signout-strip{ transition-duration:1ms }
}
`}</style>
  );
}

/** Signed-in identity + the only way out of the app. */
function AccountFooter({ variant = 'sidebar' }: { variant?: 'sidebar' | 'strip' }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setUser((d?.user as SessionUser) ?? null);
      })
      .catch(() => {
        /* Auth off or unreachable — footer just stays quiet. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* Clearing the cookie is best-effort; still send them to the door. */
    }
    router.replace('/login');
    router.refresh();
  }

  // Compact horizontal row for mobile, where the sidebar is hidden and this
  // would otherwise be the only screen size with no way to sign out.
  if (variant === 'strip') {
    if (!user) return null;
    return (
      <div className="y-glass y-top-hairline flex items-center justify-between gap-3 px-5 py-1">
        <span className="truncate text-[11.5px] tracking-[-0.005em] text-[rgba(255,248,231,0.38)]">
          {user.name || user.email}
        </span>
        <button type="button" onClick={signOut} disabled={busy} className="y-signout-strip">
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-auto">
      {user && (
        <div className="y-top-hairline pt-3.5">
          <p className="truncate px-2.5 text-[12.5px] font-medium tracking-[-0.012em] text-[rgba(255,248,231,0.72)]">
            {user.name || user.email}
          </p>
          {user.name && user.email && (
            <p className="mt-[3px] truncate px-2.5 text-[11px] tracking-[-0.004em] text-[rgba(255,248,231,0.3)]">
              {user.email}
            </p>
          )}
          <button type="button" onClick={signOut} disabled={busy} className="y-signout">
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Routes whose content owns the whole canvas instead of sitting in a reading column. */
function isFullBleed(pathname: string) {
  return pathname === '/home';
}

/** Routes whose reading column widens past the standard 560px, for a
 *  side-by-side layout that would be cramped in the normal column. */
function isWide(pathname: string) {
  // Hubs go wide for the three-column board; the board CSS switches from
  // scroll-snap to three-up via a container query the moment it gets room.
  return pathname === '/settings' || pathname.startsWith('/hubs');
}

/** Routes that render before onboarding completes, where nav would be a dead end. */
function isChromeless(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/onboarding' ||
    pathname === '/reset' ||
    pathname === '/login' ||
    pathname === '/signup'
  );
}

export function PhoneFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const fullBleed = isFullBleed(pathname);
  const chromeless = isChromeless(pathname);
  const wide = isWide(pathname);

  return (
    <>
      <FrameStyles />

      <div aria-hidden="true" className="y-frame-bg">
        <div className="y-frame-dome" />
        <div className="y-frame-pool" />
        <div className="y-frame-vignette" />
      </div>

      <div className="relative flex h-dvh w-full overflow-hidden">
        {!chromeless && (
          <aside className="y-glass y-side-edge hidden w-[236px] shrink-0 flex-col px-3.5 pb-4 pt-6 md:flex">
            <div className="flex items-center gap-2.5 px-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/yellow-sun-mark-128.png" alt="" aria-hidden="true" className="y-brand-mark" />
              <span className="text-[20px] font-semibold tracking-[-0.022em] text-[#FFF8E7]">
                Yellow
              </span>
            </div>
            <p className="mt-2.5 px-2.5 text-[12.5px] leading-[1.42] tracking-[-0.004em] text-[rgba(255,248,231,0.38)]">
              Built on what you share, not what you&rsquo;ve done.
            </p>

            <div className="mt-7">
              <TabBar orientation="sidebar" />
            </div>

            <AccountFooter />
          </aside>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {fullBleed ? (
            children
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div
                className={`mx-auto flex w-full flex-col px-5 md:px-8 ${
                  wide ? 'max-w-[1040px]' : 'max-w-[560px]'
                }`}
              >
                {children}
              </div>
            </div>
          )}

          {!chromeless && (
            <div className="y-mobile-bar md:hidden">
              <AccountFooter variant="strip" />
              <TabBar orientation="bottom" />
            </div>
          )}
        </main>
      </div>

      {/* Outside the shell on purpose: `main` and the reading column both clip
          their overflow, and a notification that scrolls away isn't one. */}
      {!chromeless && <Toast />}
    </>
  );
}
