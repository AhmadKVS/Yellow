'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { TabBar } from './TabBar';

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

            <div className="mt-auto px-3">
              <div className="flex items-center gap-2 text-[11px] text-[#FFF8E7]/30">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-[#FFD60A]/60"
                />
                Synced to AWS
              </div>
            </div>
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
              <TabBar orientation="bottom" />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
