'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAppState } from '@/lib/store';

interface TabDef {
  label: string;
  /** Bare SVG children; <Glyph> supplies the viewBox and stroke grammar. */
  icon: ReactNode;
  href: string;
  isActive: (pathname: string) => boolean;
  /** Only one tab carries a count today; the flag keeps the lookup declarative. */
  badge?: 'unread';
}

/** Chrome iconography: 24-unit grid, stroke 1.8, round caps/joins, currentColor. */
function Glyph({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      className="y-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** One dominant disc with two satellites — the bubble map's own geometry. */
const BubblesGlyph = (
  <>
    <circle cx="8.8" cy="14.8" r="4.9" />
    <circle cx="16.5" cy="7.7" r="3.7" />
    <circle cx="6.6" cy="5.9" r="2.4" />
  </>
);

const ChatsGlyph = (
  <path d="M16.6 4.3H7.4a4 4 0 0 0-4 4v4.5a4 4 0 0 0 4 4h.7v3.4l3.8-3.4h4.7a4 4 0 0 0 4-4V8.3a4 4 0 0 0-4-4Z" />
);

const HubsGlyph = (
  <>
    <rect x="3.4" y="3.4" width="7.6" height="7.6" rx="2.5" />
    <rect x="13" y="3.4" width="7.6" height="7.6" rx="2.5" />
    <rect x="3.4" y="13" width="7.6" height="7.6" rx="2.5" />
    <rect x="13" y="13" width="7.6" height="7.6" rx="2.5" />
  </>
);

const SettingsGlyph = (
  <>
    <path d="M9.59 3.02 14.41 3.02 14.25 6.44 15.69 7.27 18.58 5.42 20.98 9.59 17.94 11.16 17.94 12.84 20.98 14.41 18.58 18.58 15.69 16.73 14.25 17.56 14.41 20.98 9.59 20.98 9.75 17.56 8.31 16.73 5.42 18.58 3.02 14.41 6.06 12.84 6.06 11.16 3.02 9.59 5.42 5.42 8.31 7.27 9.75 6.44Z" />
    <circle cx="12" cy="12" r="2.55" />
  </>
);

/** A document with a signing flourish — the NDA-Signer preview, not a real tab. */
const NdaGlyph = (
  <>
    <path d="M7.6 3.4h6.2l3.6 3.6v12a1 1 0 0 1-1 1h-8.8a1 1 0 0 1-1-1v-14.6a1 1 0 0 1 1-1Z" />
    <path d="M9.4 15.4 15 9.8M15 9.8l-.5 2.4 2.4-.7L15 9.8Z" />
  </>
);

const TABS: TabDef[] = [
  {
    label: 'Bubbles',
    icon: BubblesGlyph,
    href: '/home',
    isActive: (pathname) => pathname === '/home' || pathname.startsWith('/connect'),
  },
  {
    label: 'Chats',
    icon: ChatsGlyph,
    href: '/chats',
    isActive: (pathname) => pathname.startsWith('/chat'),
    badge: 'unread',
  },
  {
    label: 'Hubs',
    icon: HubsGlyph,
    href: '/hubs',
    isActive: (pathname) => pathname.startsWith('/hubs'),
  },
  {
    label: 'Settings',
    icon: SettingsGlyph,
    href: '/settings',
    isActive: (pathname) => pathname.startsWith('/settings'),
  },
];

function TabBarStyles() {
  return (
    <style href="yellow-tabbar" precedence="high">{`
.y-glyph{ display:block; flex-shrink:0 }

/* --- sidebar: iOS tinted pill rows --- */
.y-nav-side{ display:flex; flex-direction:column; gap:3px }
.y-row{
  position:relative; display:flex; align-items:center; gap:11px;
  min-height:40px; padding:0 10px; border-radius:9999px;
  font-size:14.5px; font-weight:450; letter-spacing:-.012em;
  color:rgba(255,248,231,.55); text-decoration:none;
  transition:background-color 220ms var(--ease-ios), color 220ms var(--ease-ios);
}
.y-row:hover{ background:rgba(255,255,255,.045); color:rgba(255,248,231,.88) }
/* Active row is yellow glass, not a flat tint: it frosts the sidebar behind it. */
.y-row[data-active]{
  color:#FFD60A; font-weight:570;
  background:var(--glass-yellow);
  -webkit-backdrop-filter:var(--glass-yellow-filter);
  backdrop-filter:var(--glass-yellow-filter);
  box-shadow:
    inset 0 0 0 1px var(--glass-hairline),
    var(--glass-top-light),
    0 6px 18px -12px rgba(0,0,0,.9);
}
.y-row-count{ margin-left:auto }

/* Inert preview row — same geometry as a real tab, none of the affordance:
   no hover fill, no active state, cursor stays the pointer's own arrow. */
.y-row-inert{
  color:rgba(255,248,231,.32); cursor:default; user-select:none;
}
.y-row-soon{
  margin-left:auto; font-size:9.5px; font-weight:600; letter-spacing:.06em;
  text-transform:uppercase; color:rgba(255,214,10,.65);
  background:rgba(255,214,10,.1); border-radius:9999px; padding:2.5px 7px;
  flex-shrink:0;
}

/* --- bottom bar: chrome glass, hairline on the leading edge --- */
.y-nav-bottom{
  display:flex; flex-shrink:0; align-items:stretch; justify-content:space-around;
  padding:6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
  background:var(--glass-chrome);
  -webkit-backdrop-filter:var(--glass-chrome-filter);
  backdrop-filter:var(--glass-chrome-filter);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
}
.y-item{
  display:flex; flex:1 1 0; flex-direction:column;
  align-items:center; justify-content:center; gap:3px;
  min-height:44px; padding:1px 4px; border-radius:16px;
  color:rgba(255,248,231,.55); text-decoration:none;
  transition:color 200ms var(--ease-ios);
}
.y-item[data-active]{ color:#FFD60A }
.y-item:focus-visible{ outline-offset:-2px }
.y-item-icon{ position:relative; display:flex }
.y-item-cap{ font-size:10.5px; font-weight:500; letter-spacing:-.004em; line-height:1 }
.y-item-count{ position:absolute; top:-4px; right:-9px; --y-badge-ring:0 0 0 2px #100D07 }

/* --- unread badge: mono numerals on yellow, ink-dark, no bloom --- */
.y-badge{
  display:flex; align-items:center; justify-content:center;
  height:18px; min-width:18px; padding:0 5px; border-radius:9999px;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  color:#1A1200; font-size:10.5px; font-weight:600; line-height:1;
  font-variant-numeric:tabular-nums; letter-spacing:-.01em;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.45),
    0 1px 3px rgba(0,0,0,.55),
    var(--y-badge-ring, 0 0 rgba(0,0,0,0));
}

@media (prefers-reduced-motion: reduce){
  .y-row, .y-item{ transition-duration:1ms }
}
`}</style>
  );
}

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={['y-badge font-mono', className ?? ''].join(' ')}>
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
      <nav className="y-nav-side">
        <TabBarStyles />
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              data-active={active || undefined}
              className="y-row"
            >
              <Glyph size={22}>{tab.icon}</Glyph>
              <span>{tab.label}</span>
              {tab.badge === 'unread' && (
                <UnreadBadge count={unreadTotal} className="y-row-count" />
              )}
            </Link>
          );
        })}

        {/* Preview only — no route, no page behind it yet. */}
        <div className="y-row y-row-inert" aria-label="NDA Signer — coming soon">
          <Glyph size={22}>{NdaGlyph}</Glyph>
          <span>NDA Signer</span>
          <span className="y-row-soon">Soon</span>
        </div>
      </nav>
    );
  }

  return (
    <nav className="y-nav-bottom">
      <TabBarStyles />
      {TABS.map((tab) => {
        const active = tab.isActive(pathname);
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            data-active={active || undefined}
            className="y-item"
          >
            <span className="y-item-icon">
              <Glyph size={25}>{tab.icon}</Glyph>
              {tab.badge === 'unread' && (
                <UnreadBadge count={unreadTotal} className="y-item-count" />
              )}
            </span>
            <span className="y-item-cap">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
