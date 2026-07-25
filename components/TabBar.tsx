'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAppState } from '@/lib/store';

interface TabDef {
  label: string;
  icon: string;
  href: string;
  isActive: (pathname: string) => boolean;
  /** Only one tab carries a count today; the flag keeps the lookup declarative. */
  badge?: 'unread';
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
    badge: 'unread',
  },
  {
    label: 'Hubs',
    icon: '\u{1F310}',
    href: '/hubs',
    isActive: (pathname) => pathname.startsWith('/hubs'),
  },
];

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={[
        'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-mono text-[10px] font-semibold leading-none text-[#1A1200]',
        className ?? '',
      ].join(' ')}
      style={{
        background: 'linear-gradient(180deg,#FFE45C 0%,#FFC300 100%)',
        boxShadow: '0 0 12px rgba(255,214,10,.45), inset 0 1px 0 rgba(255,255,255,.5)',
      }}
    >
      <span className="sr-only">{count} unread</span>
      <span aria-hidden="true">{count > 9 ? '9+' : count}</span>
    </span>
  );
}

export function TabBar({ orientation = 'bottom' }: { orientation?: 'bottom' | 'sidebar' }) {
  const pathname = usePathname();
  const { unreadTotal } = useAppState();

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
              {tab.badge === 'unread' && (
                <UnreadBadge count={unreadTotal} className="ml-auto" />
              )}
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
            <span className="relative text-xl leading-none">
              {tab.icon}
              {tab.badge === 'unread' && (
                <UnreadBadge
                  count={unreadTotal}
                  className="absolute -right-2.5 -top-1 ring-2 ring-[#0B0A08]"
                />
              )}
            </span>
            <span className={active ? 'font-medium text-[#FFD60A]' : 'text-[#FFF8E7]/45'}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
