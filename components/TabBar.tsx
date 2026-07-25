'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface TabDef {
  label: string;
  icon: string;
  href: string;
  isActive: (pathname: string) => boolean;
}

const TABS: TabDef[] = [
  {
    label: 'Bubbles',
    icon: '\u{1FAE7}',
    href: '/home',
    isActive: (pathname) => pathname === '/home' || pathname.startsWith('/connect'),
  },
  {
    label: 'Chats',
    icon: '\u{1F4AC}',
    href: '/chats',
    isActive: (pathname) => pathname.startsWith('/chat'),
  },
  {
    label: 'Hubs',
    icon: '\u{1F310}',
    href: '/hubs',
    isActive: (pathname) => pathname.startsWith('/hubs'),
  },
];

export function TabBar({ orientation = 'bottom' }: { orientation?: 'bottom' | 'sidebar' }) {
  const pathname = usePathname();

  if (orientation === 'sidebar') {
    return (
      <nav className="flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200',
                active
                  ? 'bg-[#FFD60A]/10 text-[#FFD60A]'
                  : 'text-[#FFF8E7]/55 hover:bg-white/[0.04] hover:text-[#FFF8E7]/85',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className={[
                  'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-[#FFD60A] transition-opacity duration-200',
                  active ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
              />
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className={active ? 'font-medium' : ''}>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-white/[0.08] bg-[#0B0A08]/85 py-2 backdrop-blur-xl">
      {TABS.map((tab) => {
        const active = tab.isActive(pathname);
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className="flex flex-col items-center gap-1 px-4 py-1 text-xs transition-colors duration-200"
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            <span className={active ? 'font-medium text-[#FFD60A]' : 'text-[#FFF8E7]/45'}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
