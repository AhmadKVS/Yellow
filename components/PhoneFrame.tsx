'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TabBar } from './TabBar';
import Toast from './Toast';

interface SessionUser {
  name?: string;
  email?: string;
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
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-2">
        <span className="truncate text-[11.5px] text-[#FFF8E7]/45">
          {user.name || user.email}
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="shrink-0 text-[11.5px] text-[#FFD60A]/70 transition-colors duration-200 active:text-[#FFD60A] disabled:opacity-50"
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-auto px-3">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-[#FFF8E7]/30">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#FFD60A]/60" />
        Synced to AWS
      </div>

      {user && (
        <div className="border-t border-white/[0.06] pt-3">
          <p className="truncate text-[12px] font-medium text-[#FFF8E7]/70">
            {user.name || user.email}
          </p>
          {user.name && user.email && (
            <p className="mt-0.5 truncate text-[10.5px] text-[#FFF8E7]/28">{user.email}</p>
          )}
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="mt-2 text-[11px] text-[#FFF8E7]/40 underline-offset-2 transition-colors duration-200 hover:text-[#FFD60A]/80 hover:underline disabled:opacity-50"
          >
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

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#0B0A08]">
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[95vh] w-[95vh] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.22] blur-[140px]"
          style={{ background: 'radial-gradient(circle, #FFD60A 0%, transparent 68%)' }}
        />
        <div
          aria-hidden="true"
          className="absolute -left-[10vw] top-[8vh] h-[42vh] w-[42vh] rounded-full opacity-[0.10] blur-[130px]"
          style={{ background: 'radial-gradient(circle, #FFC300 0%, transparent 70%)' }}
        />
        <div
          aria-hidden="true"
          className="absolute -right-[8vw] bottom-[4vh] h-[38vh] w-[38vh] rounded-full opacity-[0.08] blur-[130px]"
          style={{ background: 'radial-gradient(circle, #FF8A00 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative flex h-dvh w-full overflow-hidden">
        {!chromeless && (
          <aside className="hidden w-[236px] shrink-0 flex-col border-r border-white/[0.07] px-5 py-7 md:flex">
            <div className="flex items-center gap-2.5 px-3">
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full bg-[#FFD60A]"
                style={{ boxShadow: '0 0 18px 2px rgba(255,214,10,0.65)' }}
              />
              <span className="text-[19px] font-semibold tracking-tight text-[#FFF8E7]">
                Yellow
              </span>
            </div>
            <p className="mt-2 px-3 text-[12px] leading-relaxed text-[#FFF8E7]/35">
              Built on what you share, not what you&rsquo;ve done.
            </p>

            <div className="mt-8">
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
              <div className="mx-auto flex w-full max-w-[560px] flex-col px-5 md:px-8">
                {children}
              </div>
            </div>
          )}

          {!chromeless && (
            <div className="md:hidden">
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
